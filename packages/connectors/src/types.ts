import type { communicationStatusEnum, contactRoleEnum, propertyStatusEnum, propertyTypeEnum } from '@reos/db';
import type { Result } from '@reos/shared';
import type { ConnectorError } from './errors.ts';

/**
 * Connector contracts (Spec §2.3 Connector Independent, §14).
 *
 * Business code depends only on these interfaces — never on Outlook /
 * PropertyMe / Grow APIs. DTOs are deliberately plain objects so future
 * real connectors can map their wire formats without leaking details.
 */

export type CommunicationStatus = (typeof communicationStatusEnum.enumValues)[number];
export type ContactRole = (typeof contactRoleEnum.enumValues)[number];
export type PropertyStatus = (typeof propertyStatusEnum.enumValues)[number];
export type PropertyType = (typeof propertyTypeEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/** A message as the business layer sees it (inbound or previously sent). */
export interface ConnectorMessage {
  id: string;
  caseId: string | null;
  propertyId: string | null;
  fromContactId: string | null;
  subject: string | null;
  /** Original content — immutable; translations live side-by-side (§2.7). */
  content: string;
  language: string;
  translatedContentZh: string | null;
  status: CommunicationStatus;
  receivedAt: Date | null;
}

export interface SendCommunicationInput {
  agencyId?: string;
  caseId?: string | null;
  propertyId?: string | null;
  toContactId?: string | null;
  /** Structured recipients, e.g. { to: ['a@b.c'] } — stored as jsonb. */
  recipients?: Record<string, unknown> | null;
  subject: string;
  /** Final human-approved content, saved verbatim (Spec §14 Mock Send). */
  content: string;
  language?: string;
}

export interface SendReceipt {
  communicationId: string;
  sentAt: Date;
}

/**
 * Mock contract for email exchange. A future OutlookEmailConnector implements
 * the exact same three methods against Microsoft Graph.
 */
export interface EmailConnector {
  listInbound(): Promise<Result<ConnectorMessage[], ConnectorError>>;
  getById(id: string): Promise<Result<ConnectorMessage | null, ConnectorError>>;
  send(input: SendCommunicationInput): Promise<Result<SendReceipt, ConnectorError>>;
}

// ---------------------------------------------------------------------------
// Property management system (PropertyMe today, mock in MVP)
// ---------------------------------------------------------------------------

export interface ConnectorProperty {
  id: string;
  agencyId: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  propertyType: PropertyType;
  status: PropertyStatus;
  externalId: string | null;
}

export interface PropertyFilter {
  agencyId?: string;
  status?: PropertyStatus;
  suburb?: string;
}

export interface PropertyConnector {
  list(filter?: PropertyFilter): Promise<Result<ConnectorProperty[], ConnectorError>>;
  getById(id: string): Promise<Result<ConnectorProperty | null, ConnectorError>>;
}

// ---------------------------------------------------------------------------
// CRM (Grow today, mock in MVP)
// ---------------------------------------------------------------------------

export interface ConnectorContact {
  id: string;
  agencyId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  preferredLanguage: string;
}

export interface CRMConnector {
  /** Contacts currently holding a given role on at least one property. */
  listByRole(role: ContactRole): Promise<Result<ConnectorContact[], ConnectorError>>;
  getById(id: string): Promise<Result<ConnectorContact | null, ConnectorError>>;
  searchByName(query: string): Promise<Result<ConnectorContact[], ConnectorError>>;
}
