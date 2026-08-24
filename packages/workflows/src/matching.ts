import { and, desc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  cases,
  communications,
  contacts,
  maintenanceJobs,
  properties,
  propertyContacts,
  type ReosDatabase,
} from '@reos/db';
import { bandOf, normaliseEmail, scoreCaseMatch, tokenCoverage, tokenSimilarity } from '@reos/domain';

/**
 * Deterministic matching pipelines (Spec Hardening §4, §27, §28).
 *
 * Contact:  raw email → normalise → exact match (unique?) → auto / ambiguous /
 *           unknown. Never auto-creates a duplicate contact.
 * Property: contact's active link → conversation context → explicit address
 *           text. Output carries confidence + reasons; uncertain ⇒ review.
 * Case:     multi-factor scoring over open cases of the property — NEVER
 *           property+caseType alone. Independent matchConfidence.
 */

// --- Contact matching (§27) ---------------------------------------------------

export type ContactMatch =
  | { kind: 'MATCHED'; contactId: string; displayName: string }
  | { kind: 'AMBIGUOUS'; candidates: Array<{ id: string; displayName: string }> };

/** Exact (case-insensitive) email → unique contact; several hits = ambiguous. */
export async function matchContactByEmail(
  db: ReosDatabase,
  fromEmail: string,
): Promise<ContactMatch> {
  const normalised = normaliseEmail(fromEmail);
  if (!normalised) return { kind: 'AMBIGUOUS', candidates: [] };
  const rows = await db
    .select({ id: contacts.id, displayName: contacts.displayName })
    .from(contacts)
    .where(ilike(contacts.email, normalised))
    .limit(5);
  if (rows.length === 1) {
    return { kind: 'MATCHED', contactId: rows[0]!.id, displayName: rows[0]!.displayName };
  }
  return { kind: 'AMBIGUOUS', candidates: rows };
}

// --- Property matching (§28) ----------------------------------------------------

export interface PropertyMatch {
  propertyId: string | null;
  confidence: number;
  reason: string[];
}

/**
 * Evidence priority: existing contact↔property relationship first (unique
 * active TENANT/OWNER link = strong), then conversation context, then an
 * explicit address mention in subject/body. AI never guesses freely.
 */
export async function matchProperty(
  db: ReosDatabase,
  input: {
    contactId: string | null;
    externalConversationId?: string | null;
    text: string;
    /** Debug-only pre-selection; null in the default raw-email flow. */
    overridePropertyId?: string | null;
  },
): Promise<PropertyMatch> {
  // 0. Explicit override (Advanced Test Overrides only).
  if (input.overridePropertyId) {
    return { propertyId: input.overridePropertyId, confidence: 1, reason: ['manual override'] };
  }

  // 1. Existing relationship.
  if (input.contactId) {
    const links = await db
      .select({ propertyId: propertyContacts.propertyId, role: propertyContacts.role })
      .from(propertyContacts)
      .where(
        and(eq(propertyContacts.contactId, input.contactId), isNull(propertyContacts.validTo)),
      )
      .limit(10);
    const tenants = links.filter((l) => l.role === 'TENANT' || l.role === 'OWNER');
    const uniqueActive = new Set(tenants.map((l) => l.propertyId));
    if (uniqueActive.size === 1) {
      return {
        propertyId: [...uniqueActive][0]!,
        confidence: 0.95,
        reason: ['contact holds exactly one current tenancy/ownership'],
      };
    }
    if (uniqueActive.size > 1) {
      // Disambiguate with conversation context or address text below.
      const narrowed = await narrowByConversationOrAddress(db, input, [...uniqueActive]);
      if (narrowed) return { ...narrowed, confidence: Math.min(0.9, narrowed.confidence + 0.05), reason: ['multiple properties for contact', ...narrowed.reason] };
      return { propertyId: null, confidence: 0.4, reason: ['contact linked to multiple properties'] };
    }
    // No PM-role link: fall through to weaker evidence but remember buyer/vendor links.
    const anyLinks = await narrowByConversationOrAddress(db, input, links.map((l) => l.propertyId));
    if (anyLinks) return anyLinks;
  }

  // 2. Conversation context — recent inbound message on the same thread.
  const viaConversation = await narrowByConversationOrAddress(db, input, null);
  if (viaConversation) return viaConversation;

  return { propertyId: null, confidence: 0, reason: ['no reliable property evidence'] };
}

async function narrowByConversationOrAddress(
  db: ReosDatabase,
  input: { externalConversationId?: string | null; text: string },
  restrictTo: string[] | null,
): Promise<PropertyMatch | null> {
  // Conversation context.
  if (input.externalConversationId) {
    const conditions = [
      eq(communications.externalConversationId, input.externalConversationId),
      eq(communications.direction, 'INBOUND'),
    ];
    if (restrictTo) conditions.push(inArray(communications.propertyId, restrictTo));
    const [recent] = await db
      .select({ propertyId: communications.propertyId })
      .from(communications)
      .where(and(...conditions, sql`${communications.propertyId} is not null`))
      .orderBy(desc(communications.receivedAt))
      .limit(1);
    if (recent?.propertyId) {
      return { propertyId: recent.propertyId, confidence: 0.85, reason: ['same conversation thread'] };
    }
  }

  // Explicit address mention: find properties whose street address appears
  // verbatim-ish in the text. Only accept when exactly one candidate matches.
  const addressHits = await db
    .select({ id: properties.id })
    .from(properties)
    .where(
      or(
        ...[...matchAddressCandidates(input.text)].map(
          (addr) => ilike(properties.addressLine1, `%${addr}%`),
        ),
      ),
    )
    .limit(2);
  if (addressHits.length === 1 && (!restrictTo || restrictTo.includes(addressHits[0]!.id))) {
    return { propertyId: addressHits[0]!.id, confidence: 0.8, reason: ['property address mentioned in message'] };
  }
  return null;
}

/** Extract plausible address lines ("42 Beach Road") from free text. */
function* matchAddressCandidates(text: string): Generator<string> {
  const re = /\b\d{1,4}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}(?:\s+(?:Road|Rd|Street|St|Avenue|Ave|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Parade|Crescent|Cres))\b/g;
  for (const m of text.matchAll(re)) yield m[0];
}

// --- Case matching (§4) -----------------------------------------------------------

export interface CaseCandidateRow {
  id: string;
  title: string;
  caseType: string;
  status: string;
  openedAt: Date;
  maintenanceJobId: string | null;
}

export interface CaseMatchDecision {
  decision: 'LINK' | 'SUGGEST' | 'NEW_CASE';
  caseId: string | null;
  matchConfidence: number;
  reason: string[];
  suggestedCaseTitle?: string;
}

const OPEN_STATUSES = ['NEW', 'AI_PROCESSING', 'READY_FOR_REVIEW', 'IN_PROGRESS', 'WAITING', 'FOLLOW_UP_DUE'] as const;

/**
 * Score every open case of the property and apply the band policy:
 * ≥ 0.90 LINK · 0.70–0.89 SUGGEST (human review, no automation) · else new case.
 */
export async function matchCaseForMessage(
  db: ReosDatabase,
  input: {
    propertyId: string | null;
    contactId: string | null;
    externalConversationId?: string | null;
    caseType: string;
    subject: string;
    content: string;
  },
): Promise<CaseMatchDecision & { suggestedCaseTitle?: string }> {
  if (!input.propertyId) {
    return { decision: 'NEW_CASE', caseId: null, matchConfidence: 0, reason: ['no property to scope cases'] };
  }

  const candidates = await db
    .select({
      id: cases.id,
      title: cases.title,
      caseType: cases.caseType,
      status: cases.status,
      openedAt: cases.openedAt,
      maintenanceJobId: cases.maintenanceJobId,
    })
    .from(cases)
    .where(and(eq(cases.propertyId, input.propertyId), inArray(cases.status, OPEN_STATUSES)))
    .orderBy(cases.openedAt);

  if (candidates.length === 0) {
    return { decision: 'NEW_CASE', caseId: null, matchConfidence: 0, reason: ['no open cases at property'] };
  }

  // Thread evidence: which cases already have communications on this conversation?
  let threadCaseIds = new Set<string>();
  if (input.externalConversationId) {
    const threadRows = await db
      .select({ caseId: communications.caseId })
      .from(communications)
      .where(eq(communications.externalConversationId, input.externalConversationId))
      .limit(20);
    threadCaseIds = new Set(threadRows.map((r) => r.caseId).filter((x): x is string => Boolean(x)));
  }

  // External entity titles/issues per job for content evidence.
  const jobTexts = new Map<string, string>();
  const jobRows = await db
    .select({ id: maintenanceJobs.id, title: maintenanceJobs.title, issue: maintenanceJobs.issue })
    .from(maintenanceJobs)
    .where(eq(maintenanceJobs.propertyId, input.propertyId));
  for (const j of jobRows) jobTexts.set(j.id, `${j.title} ${j.issue ?? ''}`);

  const weekAgo = new Date(Date.now() - 7 * 86400000);
  let best: CaseMatchDecision | null = null;

  for (const c of candidates) {
    const [recent] = await db
      .select({ id: communications.id })
      .from(communications)
      .where(and(eq(communications.caseId, c.id), gt(communications.createdAt, weekAgo)))
      .limit(1);

    let senderOnCase = false;
    let senderIsTenant = false;
    if (input.contactId) {
      const [hit] = await db
        .select({ id: communications.id })
        .from(communications)
        .where(and(eq(communications.caseId, c.id), eq(communications.senderContactId, input.contactId)))
        .limit(1);
      senderOnCase = Boolean(hit);
      if (!senderOnCase) {
        // §28: the sender being the property's current tenant/owner is real
        // participant evidence even before any reply history exists.
        const [link] = await db
          .select({ id: propertyContacts.id })
          .from(propertyContacts)
          .where(
            and(
              eq(propertyContacts.contactId, input.contactId),
              eq(propertyContacts.propertyId, input.propertyId),
              inArray(propertyContacts.role, ['TENANT', 'OWNER'] as const),
              isNull(propertyContacts.validTo),
            ),
          )
          .limit(1);
        senderIsTenant = Boolean(link);
      }
    }

    const jobText = c.maintenanceJobId ? jobTexts.get(c.maintenanceJobId) ?? '' : '';
    const combinedMessageText = `${input.subject} ${input.content}`;
    const scored = scoreCaseMatch({
      sameConversation: false,
      sameCommunicationThread: threadCaseIds.has(c.id),
      // Topic identity: how much of the PM job's signature the message covers.
      sameExternalEntity: Boolean(jobText) && tokenCoverage(jobText, combinedMessageText) >= 0.3,
      sameProperty: true,
      sameContact: senderOnCase || senderIsTenant,
      sameCaseType: c.caseType === input.caseType,
      subjectSimilarity: tokenSimilarity(input.subject, c.title),
      contentSimilarity: Math.max(tokenSimilarity(input.content, c.title), jobText ? tokenSimilarity(input.content, jobText) : 0),
      recentlyActive: Boolean(recent),
      caseIsOpen: true,
    });

    const band = bandOf(scored.confidence);
    const candidate: CaseMatchDecision = {
      decision: band === 'AUTO' ? 'LINK' : band === 'REVIEW' ? 'SUGGEST' : 'NEW_CASE',
      caseId: band === 'NEEDS_MANUAL_CLASSIFICATION' ? null : c.id,
      matchConfidence: scored.confidence,
      reason: scored.reason,
      suggestedCaseTitle: c.title,
    };
    if (!best || candidate.matchConfidence > best.matchConfidence) best = candidate;
  }

  // Nothing reached even REVIEW band → fresh case.
  if (best!.decision === 'NEW_CASE') {
    return { decision: 'NEW_CASE', caseId: null, matchConfidence: best!.matchConfidence, reason: best!.reason };
  }
  return best!;
}
