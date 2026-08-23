/**
 * @reos/connectors
 *
 * Connector abstraction layer (Spec §2.3, §14). Business code never calls
 * Outlook / PropertyMe / Grow APIs directly — only these interfaces:
 *
 *   email/     EmailConnector    → MockEmailConnector (Phase 2), OutlookEmailConnector (Phase 2 of project)
 *   property/  PropertyConnector → MockPropertyConnector (Phase 2), PropertyMeConnector (future)
 *   crm/       CRMConnector      → MockCRMConnector (Phase 2), GrowConnector (future)
 */
export const PACKAGE_NAME = '@reos/connectors';
