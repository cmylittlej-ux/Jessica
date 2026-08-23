import type {
  aiActions,
  approvals,
  cases,
  communications,
  contacts,
  activities,
  auditLogs,
  properties,
  propertyContacts,
  tasks,
} from '../schema/index.ts';

/**
 * Deterministic mock dataset (Spec §15). Same seed → byte-identical dataset,
 * so `reset + reseed` always reproduces the same test environment (Phase 2 gate).
 * No real personal data — all names/addresses are invented.
 */

/** Small deterministic PRNG (mulberry32-style LCG). */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  'Charlotte', 'Jack', 'Amelia', 'Oliver', 'Mia', 'William', 'Ava', 'Thomas',
  'Sophie', 'Henry', 'Chloe', 'Lucas', 'Isla', 'Ethan', 'Grace', 'Noah',
  'Zoe', 'Liam', 'Ruby', 'Max', 'Ella', 'Leo', 'Hannah', 'Oscar', 'Ivy',
  'Felix', 'Matilda', 'Archie', 'Penelope', 'Samuel',
];

const LAST_NAMES = [
  'Mitchell', 'Harrison', 'Whitfield', 'Carrington', 'Ashworth', 'Blackwood',
  'Fairfax', 'Kingsley', 'Ravenscroft', 'Thornbury', 'Ellsworth', 'Prescott',
  'Hartley', 'Windsor', 'Radcliffe', 'Sinclair', 'Beaumont', 'Colville',
  'Drayton', 'Eastwood', 'Fenwick', 'Gresham', 'Holbrook', 'Inglewood',
  'Jardine', 'Kendall', 'Lockhart', 'Marlowe', 'Netherby', 'Oakhurst',
];

const SUBURBS = [
  ['Carlton', 3053], ['Fitzroy', 3065], ['Richmond', 3121],
  ['South Yarra', 3141], ['Brunswick', 3056], ['Docklands', 3008],
  ['St Kilda', 3182], ['Hawthorn', 3122], ['Camberwell', 3124],
  ['Footscray', 3011], ['Northcote', 3070], ['Elsternwick', 3185],
] as const;

const STREETS = [
  'Drummond Street', 'Gertrude Street', 'Bridge Road', 'Toorak Road',
  'Sydney Road', 'Collins Street', 'Fitzroy Street', 'Glenferrie Road',
  'Burke Road', 'Hopkins Street', 'High Street', 'Glenhuntly Road',
];

const MAINTENANCE_ISSUES = [
  'Dishwasher failure', 'Hot water system failure', 'Bathroom water leak',
  'Air conditioner not cooling', 'Oven element broken', 'Garage door jammed',
];

export interface SeedCounts {
  properties: number;
  owners: number;
  tenants: number;
  buyers: number;
  vendors: number;
  communications: number;
  tasks: number;
  cases: number;
  aiActions: number;
  approvals: number;
  activities: number;
}

export const TARGET_COUNTS: SeedCounts = {
  properties: 22,
  owners: 30,
  tenants: 25,
  buyers: 40,
  vendors: 10,
  communications: 60,
  tasks: 25,
  cases: 15,
  aiActions: 18,
  approvals: 10,
  activities: 120,
};

const pad = (n: number, width = 3) => String(n).padStart(width, '0');

/**
 * Fixed epoch for all seeded timestamps. Resets must produce byte-identical
 * databases (Phase 2 Gate), so "now" defaults to a constant instead of the
 * wall clock; tests may still pass an explicit instant.
 */
export const SEED_EPOCH = new Date('2026-08-23T00:00:00.000Z');

export function buildSeedData(now: Date = SEED_EPOCH, seed = 20260823) {
  const rand = makeRandom(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

  const agency = {
    id: 'agy_001',
    name: 'Bayside Property Partners (Simulated)',
    timezone: 'Australia/Melbourne',
    defaultLanguage: 'zh',
    createdAt: now,
    updatedAt: now,
  };

  const userRows = [
    { id: 'usr_001', name: 'Neil', email: 'neil@bayside.example', role: 'ADMIN' as const },
    { id: 'usr_002', name: 'Sarah Chen', email: 'sarah@bayside.example', role: 'PROPERTY_MANAGER' as const },
    { id: 'usr_003', name: 'David Okafor', email: 'david@bayside.example', role: 'AGENT' as const },
  ].map((u) => ({
    id: u.id,
    agencyId: agency.id,
    name: u.name,
    email: u.email,
    workingLanguage: 'zh',
    role: u.role,
    aiAutonomyLevel: 'STANDARD',
    createdAt: now,
    updatedAt: now,
  }));
  const usersList = userRows;

  // --- Contacts: role-counted per Spec §15 ---------------------------------
  const rolePlan: Array<{ role: 'OWNER' | 'TENANT' | 'BUYER' | 'VENDOR'; count: number }> = [
    { role: 'OWNER', count: TARGET_COUNTS.owners },
    { role: 'TENANT', count: TARGET_COUNTS.tenants },
    { role: 'BUYER', count: TARGET_COUNTS.buyers },
    { role: 'VENDOR', count: TARGET_COUNTS.vendors },
  ];

  const contactRows: (typeof contacts.$inferInsert)[] = [];
  const idsByRole: {
    OWNER: string[];
    TENANT: string[];
    BUYER: string[];
    VENDOR: string[];
  } = { OWNER: [], TENANT: [], BUYER: [], VENDOR: [] };
  let contactSeq = 0;
  let nameIdx = 0;

  for (const plan of rolePlan) {
    for (let i = 0; i < plan.count; i++) {
      contactSeq += 1;
      const first = FIRST_NAMES[nameIdx % FIRST_NAMES.length]!;
      const last = LAST_NAMES[Math.floor(nameIdx / FIRST_NAMES.length) % LAST_NAMES.length]!;
      nameIdx += 1;
      const id = `con_${pad(contactSeq)}`;
      contactRows.push({
        id,
        agencyId: agency.id,
        firstName: first,
        lastName: last,
        displayName: `${first} ${last}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}${contactSeq}@example.com`,
        phone: `+61 4${pad(Math.floor(rand() * 9000000) + 1000000, 7)}`,
        preferredLanguage: rand() < 0.35 ? 'zh' : 'en',
        notes: null,
        createdAt: now,
        updatedAt: now,
      });
      idsByRole[plan.role].push(id);
    }
  }

  // --- Properties ------------------------------------------------------------
  const propertyRows: (typeof properties.$inferInsert)[] = [];
  for (let i = 1; i <= TARGET_COUNTS.properties; i++) {
    const [suburb, postcode] = SUBURBS[i % SUBURBS.length]!;
    const salesPhase = i % 4 === 0; // every 4th property runs a sales track
    propertyRows.push({
      id: `prp_${pad(i)}`,
      agencyId: agency.id,
      addressLine1: `${(i * 7) % 200 + 1} ${pick(STREETS)}`,
      addressLine2: i % 5 === 0 ? `Unit ${i % 12 + 1}` : null,
      suburb,
      state: 'VIC',
      postcode: String(postcode),
      country: 'Australia',
      propertyType: pick(['HOUSE', 'UNIT', 'APARTMENT', 'TOWNHOUSE'] as const),
      status: salesPhase ? pick(['AVAILABLE', 'UNDER_OFFER'] as const) : 'LEASED',
      source: 'MANUAL',
      externalId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // --- Property↔Contact links -------------------------------------------------
  const propertyContactRows: (typeof propertyContacts.$inferInsert)[] = [];
  let linkSeq = 0;
  const addLink = (propertyId: string, contactId: string, role: 'OWNER' | 'TENANT' | 'BUYER' | 'VENDOR') => {
    linkSeq += 1;
    propertyContactRows.push({
      id: `prc_${pad(linkSeq)}`,
      propertyId,
      contactId,
      role,
      validFrom: now,
      validTo: null,
      createdAt: now,
    });
  };
  propertyRows.forEach((p, idx) => {
    addLink(p.id, idsByRole.OWNER[idx % idsByRole.OWNER.length]!, 'OWNER');
    if (idx % 4 !== 0 && idx < TARGET_COUNTS.properties - 2) {
      addLink(p.id, idsByRole.TENANT[idx % idsByRole.TENANT.length]!, 'TENANT');
    }
    if (idx % 4 === 0) {
      addLink(p.id, idsByRole.VENDOR[idx % idsByRole.VENDOR.length]!, 'VENDOR');
      addLink(p.id, idsByRole.BUYER[idx % idsByRole.BUYER.length]!, 'BUYER');
    }
  });

  // Spec §15 minimums are role-level views: every seeded role contact must
  // hold at least one property_contacts row, otherwise CRM role queries
  // silently under-report. Round-robin the remaining contacts onto properties.
  const roleGuarantees = [
    ['OWNER', idsByRole.OWNER],
    ['TENANT', idsByRole.TENANT],
    ['BUYER', idsByRole.BUYER],
    ['VENDOR', idsByRole.VENDOR],
  ] as const;
  for (const [role, ids] of roleGuarantees) {
    const linked = new Set(
      propertyContactRows.filter((r) => r.role === role).map((r) => r.contactId),
    );
    ids.forEach((contactId, i) => {
      if (!linked.has(contactId)) {
        addLink(propertyRows[i % propertyRows.length]!.id, contactId, role);
      }
    });
  }

  // --- Cases -------------------------------------------------------------------
  const caseRows: (typeof cases.$inferInsert)[] = [];
  const pmCaseTypes = ['MAINTENANCE', 'RENT', 'ARREARS', 'LEASE_RENEWAL', 'INSPECTION', 'VACATE', 'COMPLIANCE'] as const;
  const salesCaseTypes = ['BUYER_ENQUIRY', 'OFFER', 'OPEN_INSPECTION', 'NEGOTIATION', 'SETTLEMENT'] as const;
  for (let i = 1; i <= TARGET_COUNTS.cases; i++) {
    const isSales = i % 3 === 0;
    const property = propertyRows[(i * 2 - 1) % propertyRows.length]!;
    const issue = pick(MAINTENANCE_ISSUES);
    caseRows.push({
      id: `cas_${pad(i)}`,
      agencyId: agency.id,
      propertyId: property.id,
      title: isSales ? `${property.addressLine1} — sales process` : issue,
      businessDomain: isSales ? 'SALES' : 'PROPERTY_MANAGEMENT',
      caseType: isSales ? salesCaseTypes[i % salesCaseTypes.length]! : pmCaseTypes[i % pmCaseTypes.length]!,
      priority: i <= 2 ? 'HIGH' : 'NORMAL',
      status: i <= 3 ? ('IN_PROGRESS' as const) : ('NEW' as const),
      summary: null,
      assignedUserId: usersList[i % usersList.length]!.id,
      openedAt: now,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // --- Communications ------------------------------------------------------------
  const communicationRows: (typeof communications.$inferInsert)[] = [];
  for (let i = 1; i <= TARGET_COUNTS.communications; i++) {
    const kase = caseRows[(i - 1) % caseRows.length]!;
    const inbound = i % 3 !== 0;
    const sender = inbound
      ? idsByRole[caseRows.indexOf(kase) % 3 === 0 ? 'BUYER' : 'TENANT'][i % 20]!
      : null;
    const enBody = inbound
      ? `Hi Neil, just following up regarding ${kase.title}. Could you please advise on the next steps? Kind regards.`
      : `Thanks for reaching out. We have received your request about ${kase.title} and will update you shortly.`;
    communicationRows.push({
      id: `com_${pad(i)}`,
      caseId: kase.id,
      propertyId: kase.propertyId,
      direction: inbound ? 'INBOUND' : 'OUTBOUND',
      channel: 'EMAIL',
      senderContactId: sender,
      recipientData: inbound
        ? { to: ['neil@bayside.example'] }
        : { to: [`${contactSeq}@example.com`] },
      subject: inbound ? `Update request — ${kase.title}` : `Re: ${kase.title}`,
      originalContent: enBody,
      originalLanguage: 'en',
      translatedContentZh: inbound
        ? `您好 Neil，想跟进一下「${kase.title}」的进展，请问下一步如何安排？谢谢。`
        : `感谢您的联系。我们已收到您关于「${kase.title}」的请求，将尽快更新进展。`,
      translatedContentEn: enBody,
      status: inbound ? 'RECEIVED' : 'SENT',
      externalId: null,
      receivedAt: inbound ? now : null,
      sentAt: inbound ? null : now,
      createdAt: now,
    });
  }

  // --- Tasks -----------------------------------------------------------------------
  const taskTitles = [
    'Request photos of the issue', 'Request quote from tradesperson',
    'Get owner approval for repair', 'Schedule repair visit',
    'Follow up with buyer', 'Prepare section 32 documents',
    'Confirm open inspection time', 'Send lease renewal offer',
  ];
  const taskRows: (typeof tasks.$inferInsert)[] = [];
  for (let i = 1; i <= TARGET_COUNTS.tasks; i++) {
    const kase = caseRows[(i - 1) % caseRows.length]!;
    taskRows.push({
      id: `tsk_${pad(i)}`,
      caseId: kase.id,
      propertyId: kase.propertyId,
      assignedUserId: usersList[i % usersList.length]!.id,
      title: taskTitles[i % taskTitles.length]!,
      description: null,
      priority: 'NORMAL',
      status: i <= 5 ? ('IN_PROGRESS' as const) : ('OPEN' as const),
      dueAt: new Date(now.getTime() + (i % 7) * 86400000),
      source: i % 2 === 0 ? 'AI' : 'HUMAN',
      createdByType: i % 2 === 0 ? 'AI' : 'USER',
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // --- AI actions + approvals ----------------------------------------------------------
  const aiActionRows: (typeof aiActions.$inferInsert)[] = [];
  for (let i = 1; i <= TARGET_COUNTS.aiActions; i++) {
    const kase = caseRows[(i - 1) % caseRows.length]!;
    aiActionRows.push({
      id: `act_${pad(i)}`,
      caseId: kase.id,
      actionType: i % 2 === 0 ? 'GENERATE_REPLY' : 'CLASSIFY_COMMUNICATION',
      provider: 'mock',
      model: 'mock-1',
      inputSummary: `Mock AI action #${i} for case ${kase.id}`,
      proposedPayload: { draft: 'Mock proposed payload', locale: 'en' },
      finalPayload: null,
      confidence: 0.72 + ((i * 13) % 27) / 100,
      status: i <= TARGET_COUNTS.approvals ? 'PROPOSED' : 'EXECUTED',
      executedAt: i <= TARGET_COUNTS.approvals ? null : now,
      createdAt: now,
    });
  }

  const approvalRows: (typeof approvals.$inferInsert)[] = [];
  for (let i = 1; i <= TARGET_COUNTS.approvals; i++) {
    approvalRows.push({
      id: `apr_${pad(i)}`,
      caseId: aiActionRows[i - 1]!.caseId,
      actionId: aiActionRows[i - 1]!.id,
      requestedUserId: usersList[0]!.id,
      status: 'PENDING',
      requestedAt: now,
      reviewedAt: null,
      reviewedBy: null,
      decisionNote: null,
    });
  }

  // --- Activities + audit logs -----------------------------------------------------------
  const activityRows: (typeof activities.$inferInsert)[] = [];
  const activityTypes = [
    'EMAIL_RECEIVED', 'CASE_OPENED', 'TASK_CREATED', 'AI_SUMMARY_GENERATED',
    'APPROVAL_REQUESTED', 'STATUS_CHANGED', 'COMMUNICATION_SENT', 'NOTE_ADDED',
  ] as const;
  for (let i = 1; i <= TARGET_COUNTS.activities; i++) {
    const kase = caseRows[(i - 1) % caseRows.length]!;
    activityRows.push({
      id: `actv_${pad(i, 4)}`,
      agencyId: agency.id,
      propertyId: kase.propertyId,
      caseId: kase.id,
      actorType: pick(['USER', 'AI', 'SYSTEM'] as const),
      actorId: i % 2 === 0 ? usersList[i % usersList.length]!.id : null,
      activityType: activityTypes[i % activityTypes.length]!,
      title: `${activityTypes[i % activityTypes.length]!.replaceAll('_', ' ').toLowerCase()} on ${kase.title}`,
      description: null,
      metadata: { seq: i },
      occurredAt: new Date(now.getTime() - i * 3600000),
    });
  }

  const auditLogRows: (typeof auditLogs.$inferInsert)[] = [];
  for (let i = 1; i <= 36; i++) {
    const kase = caseRows[(i - 1) % caseRows.length]!;
    auditLogRows.push({
      id: `aud_${pad(i)}`,
      actorType: i % 3 === 0 ? 'AI' : 'SYSTEM',
      actorId: null,
      action: i % 3 === 0 ? 'ai.propose' : 'system.transition',
      entityType: 'Case',
      entityId: kase.id,
      beforeData: null,
      afterData: { status: kase.status },
      metadata: { seed: true },
      createdAt: new Date(now.getTime() - i * 1800000),
    });
  }

  return {
    agencies: [agency],
    users: usersList,
    contacts: contactRows,
    properties: propertyRows,
    propertyContacts: propertyContactRows,
    cases: caseRows,
    communications: communicationRows,
    tasks: taskRows,
    aiActions: aiActionRows,
    approvals: approvalRows,
    activities: activityRows,
    auditLogs: auditLogRows,
  };
}

export type SeedDataset = ReturnType<typeof buildSeedData>;
