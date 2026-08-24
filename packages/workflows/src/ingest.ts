import { and, eq } from 'drizzle-orm';
import { communications, type ReosDatabase } from '@reos/db';
import { normaliseEmail } from '@reos/domain';
import { ok, err, type Result } from '@reos/shared';

/**
 * Raw email ingestion (Spec Hardening §7, §8, §36).
 *
 * The simulator and any future Outlook connector share this single entry
 * point: a RAW email (from/to/subject/body) — never pre-selected entity ids.
 * Identity resolution happens inside the workflow; ingestion only guarantees:
 *   - source identity fields are populated,
 *   - the same (source, accountId, messageId) can never create two rows.
 */

export interface RawEmailInput {
  fromEmail: string;
  fromName?: string;
  toEmail?: string;
  subject: string;
  body: string;
  receivedAt?: Date;
  /** External identity — required for OUTLOOK source, optional for simulation. */
  externalMessageId?: string;
  externalConversationId?: string;
  source?: 'SIMULATION' | 'OUTLOOK';
  sourceAccountId?: string;
  /** §7 debug-only override — pre-links a property; NEVER used by E2E. */
  debugPropertyId?: string;
}

export interface IngestResult {
  communicationId: string;
  duplicate: boolean;
}

/** Insert-once semantics: replaying the same message id is a no-op. */
export async function ingestRawEmail(
  db: ReosDatabase,
  raw: RawEmailInput,
): Promise<Result<IngestResult, Error>> {
  const from = normaliseEmail(raw.fromEmail);
  if (!from || !raw.body.trim()) {
    return err(new Error('ingest requires a non-empty from email and body'));
  }

  const source = raw.source ?? 'SIMULATION';
  const sourceAccountId = raw.sourceAccountId ?? 'bayside-mailbox';
  const externalMessageId =
    raw.externalMessageId ?? `raw-${source}-${hashOf(`${from}|${raw.subject}|${raw.body}`)}`;

  // §36: idempotent ingestion. The unique index backs this up at the DB level;
  // the explicit check gives callers a friendly DUPLICATE signal.
  const [existing] = await db
    .select({ id: communications.id })
    .from(communications)
    .where(
      and(
        eq(communications.source, source),
        eq(communications.sourceAccountId, sourceAccountId),
        eq(communications.externalMessageId, externalMessageId),
      ),
    )
    .limit(1);
  if (existing) {
    return ok({ communicationId: existing.id, duplicate: true });
  }

  const now = raw.receivedAt ?? new Date();
  const id = `com_${crypto.randomUUID()}`;
  try {
    await db.insert(communications).values({
      id,
      direction: 'INBOUND',
      channel: 'EMAIL',
      senderType: 'EXTERNAL', // refined to CONTACT by the workflow's matcher
      senderData: { email: from, name: raw.fromName ?? null },
      recipientData: { to: [normaliseEmail(raw.toEmail) || 'neil@bayside.example'] },
      subject: raw.subject.trim() || '(no subject)',
      originalContent: raw.body,
      originalLanguage: 'en',
      status: 'RECEIVED',
      source,
      sourceAccountId,
      externalMessageId,
      externalConversationId: raw.externalConversationId ?? null,
      propertyId: raw.debugPropertyId ?? null,
      sourceCreatedAt: now,
      lastSyncedAt: now,
      receivedAt: now,
      createdAt: now,
    });
  } catch (cause) {
    // Race with a concurrent insert of the same message → treat as duplicate.
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes('communications_source_message_uidx')) {
      const [row] = await db
        .select({ rid: communications.id })
        .from(communications)
        .where(eq(communications.externalMessageId, externalMessageId))
        .limit(1);
      if (row) return ok({ communicationId: row.rid, duplicate: true });
    }
    return err(new Error(`ingest failed: ${message}`));
  }

  return ok({ communicationId: id, duplicate: false });
}

function hashOf(text: string): string {
  // Deterministic short hash so identical raw emails dedupe even without an
  // explicit message id (simulation convenience, NOT used for real Outlook).
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
