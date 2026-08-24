/**
 * Source ownership matrix (Spec Hardening §1, §2, §22).
 *
 * PropertyMe Manage PM = PM source of truth · Grow CRM = Sales source of
 * truth · Outlook = email/communication source of truth. REOS is the
 * operational intelligence layer and must never build a competing master
 * dataset or mutate source-owned canonical fields (they would only be
 * overwritten by the next sync).
 */

export type SourceSystem = 'PROPERTYME' | 'GROW' | 'OUTLOOK';

export type OwnedBy = 'PROPERTYME' | 'GROW' | 'OUTLOOK' | 'REOS';

/** Entity → its single source of truth. Anything absent defaults to REOS. */
export const SOURCE_OWNERSHIP: Record<string, OwnedBy> = {
  // Property Management — PropertyMe owns the facts.
  property: 'PROPERTYME',
  owner: 'PROPERTYME',
  tenant: 'PROPERTYME',
  tenancy: 'PROPERTYME',
  lease: 'PROPERTYME',
  rent: 'PROPERTYME',
  arrears: 'PROPERTYME',
  maintenance_job: 'PROPERTYME',
  inspection: 'PROPERTYME',
  pm_finance: 'PROPERTYME',
  // Sales — Grow CRM owns the funnel facts.
  buyer: 'GROW',
  vendor: 'GROW',
  listing: 'GROW',
  sales_enquiry: 'GROW',
  open_inspection: 'GROW',
  offer: 'GROW',
  sales_follow_up: 'GROW',
  // Email — Outlook owns transport + identity.
  email: 'OUTLOOK',
  attachment: 'OUTLOOK',
};

export function sourceOwnerOf(entityType: string): OwnedBy {
  return SOURCE_OWNERSHIP[entityType] ?? 'REOS';
}

/**
 * §22: fields REOS may never write on mirror entities because the next sync
 * would clobber them. Used as a guard in repositories/connectors.
 */
export const SOURCE_OWNED_FIELDS = [
  'addressLine1', 'suburb', 'state', 'postcode', 'country', // property identity
  'rentAmount', 'rentFrequency', 'startDate', 'endDate',    // lease/tenancy terms
  'quoteAmount', 'tradeName',                                // maintenance job facts
  'sourceStatus',                                            // lifecycle is source-driven
] as const;
