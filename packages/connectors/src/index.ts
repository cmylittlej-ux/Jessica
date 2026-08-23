/**
 * @reos/connectors
 *
 * Connector abstraction layer (Spec §2.3, §14). Business code never calls
 * Outlook / PropertyMe / Grow APIs directly — only these interfaces:
 *
 *   EmailConnector    → createMockEmailConnector (Phase 2), OutlookEmailConnector (future)
 *   PropertyConnector → createMockPropertyConnector (Phase 2), PropertyMeConnector (future)
 *   CRMConnector      → createMockCRMConnector (Phase 2), GrowConnector (future)
 *
 * All methods return Result<T, ConnectorError> — no silent failures, no
 * exceptions across layer boundaries (Spec §29).
 */

export { ConnectorError, isConnectorError, type ConnectorErrorCode } from './errors.ts';
export type {
  CommunicationStatus,
  ContactRole,
  ConnectorContact,
  ConnectorMessage,
  ConnectorProperty,
  CRMConnector,
  EmailConnector,
  PropertyConnector,
  PropertyFilter,
  PropertyStatus,
  PropertyType,
  SendCommunicationInput,
  SendReceipt,
} from './types.ts';
export { createMockEmailConnector } from './mock/email.ts';
export { createMockPropertyConnector } from './mock/property.ts';
export { createMockCRMConnector } from './mock/crm.ts';
