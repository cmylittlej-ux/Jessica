import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * All enumerations follow the Spec exactly (§5, §6, §7, §10).
 * Enum member order matters for future ALTER TYPE additions — always append.
 */

// --- People / org -----------------------------------------------------------

export const userRoleEnum = pgEnum('user_role', [
  'ADMIN',
  'AGENT',
  'PROPERTY_MANAGER',
]);

export const contactRoleEnum = pgEnum('contact_role', [
  'OWNER',
  'TENANT',
  'BUYER',
  'VENDOR',
  'SOLICITOR',
  'TRADESPERSON',
  'BROKER',
  'OTHER',
]);

// --- Property ----------------------------------------------------------------

export const propertyTypeEnum = pgEnum('property_type', [
  'HOUSE',
  'UNIT',
  'APARTMENT',
  'TOWNHOUSE',
  'LAND',
  'COMMERCIAL',
  'OTHER',
]);

export const propertyStatusEnum = pgEnum('property_status', [
  'AVAILABLE',
  'UNDER_OFFER',
  'SOLD',
  'LEASED',
  'OFF_MARKET',
  'WITHDRAWN',
]);

export const propertySourceEnum = pgEnum('property_source', [
  'MANUAL',
  'PROPERTYME',
  'GROW',
  'IMPORT',
]);

// --- Classification taxonomy (Spec §6) ---------------------------------------

export const businessDomainEnum = pgEnum('business_domain', [
  'PROPERTY_MANAGEMENT',
  'SALES',
  'ADMINISTRATION',
  'UNKNOWN',
]);

export const caseTypeEnum = pgEnum('case_type', [
  // Property Management
  'MAINTENANCE',
  'RENT',
  'ARREARS',
  'LEASE',
  'LEASE_RENEWAL',
  'VACATE',
  'INSPECTION',
  'OWNER_REQUEST',
  'TENANT_REQUEST',
  'INVOICE',
  'QUOTE',
  'COMPLIANCE',
  'KEYS',
  'BOND',
  'UTILITIES',
  'COMPLAINT',
  'GENERAL_PM',
  // Sales
  'BUYER_ENQUIRY',
  'BUYER_FOLLOW_UP',
  'VENDOR',
  'LISTING',
  'OPEN_INSPECTION',
  'OFFER',
  'NEGOTIATION',
  'CONTRACT',
  'FINANCE',
  'BUILDING_INSPECTION',
  'DEPOSIT',
  'SETTLEMENT',
  'ADVERTISING',
  'SOLICITOR_SALES',
  'GENERAL_SALES',
  // Administration
  'INTERNAL',
  'MARKETING',
  'NEWSLETTER',
  'SYSTEM_NOTIFICATION',
  'SPAM',
  'OTHER_ADMIN',
]);

export const priorityEnum = pgEnum('priority', [
  'CRITICAL',
  'HIGH',
  'NORMAL',
  'LOW',
]);

export const workflowStatusEnum = pgEnum('workflow_status', [
  'NEW',
  'AI_PROCESSING',
  'READY_FOR_REVIEW',
  'IN_PROGRESS',
  'WAITING',
  'FOLLOW_UP_DUE',
  'COMPLETED',
  'ARCHIVED',
]);

export const actionRequiredEnum = pgEnum('action_required', [
  'URGENT_ACTION',
  'DECISION_REQUIRED',
  'APPROVAL_REQUIRED',
  'REPLY_REQUIRED',
  'FOLLOW_UP_REQUIRED',
  'WAITING_FOR_OTHER',
  'INFORMATION_ONLY',
  'NO_ACTION',
]);

// --- Communication ------------------------------------------------------------

export const directionEnum = pgEnum('direction', [
  'INBOUND',
  'OUTBOUND',
  'INTERNAL',
]);

export const channelEnum = pgEnum('channel', [
  'EMAIL',
  'SMS',
  'PHONE',
  'NOTE',
  'SYSTEM',
]);

export const communicationStatusEnum = pgEnum('communication_status', [
  'RECEIVED',
  'PENDING_SEND',
  'SENT',
  'FAILED',
]);

// --- Tasks / Approvals / AI ----------------------------------------------------

export const taskStatusEnum = pgEnum('task_status', [
  'OPEN',
  'IN_PROGRESS',
  'WAITING',
  'DONE',
  'CANCELLED',
]);

export const taskSourceEnum = pgEnum('task_source', [
  'AI',
  'HUMAN',
  'WORKFLOW',
]);

export const createdByTypeEnum = pgEnum('created_by_type', [
  'USER',
  'AI',
  'SYSTEM',
]);

export const approvalStatusEnum = pgEnum('approval_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);

export const aiActionTypeEnum = pgEnum('ai_action_type', [
  'CLASSIFY_COMMUNICATION',
  'SUMMARISE_CASE',
  'RECOMMEND_ACTIONS',
  'GENERATE_REPLY',
  'TRANSLATE',
  'SEND_EMAIL',
  'CREATE_TASK',
]);

export const aiActionStatusEnum = pgEnum('ai_action_status', [
  'PROPOSED',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'FAILED',
]);

export const feedbackTypeEnum = pgEnum('feedback_type', [
  'ACCEPTED',
  'EDITED',
  'REJECTED',
  'RECLASSIFIED',
]);

// --- Activity / Audit -------------------------------------------------------------

export const actorTypeEnum = pgEnum('actor_type', [
  'USER',
  'AI',
  'SYSTEM',
  'EXTERNAL',
]);
