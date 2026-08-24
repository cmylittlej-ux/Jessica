# Outlook — Auth & Permissions (Phase 2)

> **Status: PENDING AZURE APP REGISTRATION (Gate 2.4).**
> This document records the permission DECISION and its rationale now; the
> tenant/app ids and first successful token exchange are filled in at Gate 2.4.

## Permission Decision (least privilege)

| Permission | Requested? | Rationale |
|---|---|---|
| `Mail.Read` (Application or Delegated per mailbox model) | ✅ planned | read message body, sender, recipients, subject, received/modified timestamps, conversationId, attachment metadata — the minimum set covering §16 |
| `Mail.ReadBasic` | ❌ | lacks body — insufficient for classification/translation |
| **`Mail.Send`** | ❌ **FORBIDDEN IN PHASE 2** | Spec §17/§41: no real send capability exists in this phase; SEND is a separate controlled gate after A1 reconciliation is independently accepted |
| `MailboxSettings.Read` | ❌ | not needed for message sync |

The connector code must structurally lack a send path in Phase 2: the Graph
client exposes only list/get/delta operations. Shadow-mode ingest enters via
the single normalized ingestion pipeline (`ingestRawEmail`), never a
second workflow (Spec §23).

## Mailbox Model

Phase 2 starts with ONE authorized test mailbox. The auth layer keeps token
state inside the integration package (never in business-domain code) and is
shaped to later support multiple staff mailboxes / shared mailboxes /
multi-user agency, keyed by `sourceAccountId`.

## Delta Sync Constraints (Spec §20–§22)

- Message delta sync is folder-scoped → cursor state per `mailbox + folder`
  (`OutlookSyncCursor`: sourceAccountId, folderId, deltaLink,
  lastSuccessfulSyncAt, status). nextLink/deltaLink are treated as opaque.
- Invalid cursor ⇒ mark invalid + controlled folder reconciliation + dedupe by
  composite source identity — never delete-and-reimport.
- Removed/moved provider messages ⇒ lifecycle metadata only
  (`sourceStatus`, `sourceDeletedAt`, `sourceFolderId`) — REOS work history is
  never destroyed.

## Secrets Policy

Never committed to Git: client secret, refresh tokens, access tokens,
tenant/app secrets. Server-side env only (`.env*` ignored). Connector/sync
failures are logged to IntegrationSyncRun without any token material.

## Wire DTO Mapping (field names verified against official Graph docs at 2.4)

| Graph field | REOS target |
|---|---|
| `id` | externalMessageId |
| `conversationId` | externalConversationId |
| mailbox/account | sourceAccountId |
| `from.emailAddress` | senderData / Contact match |
| `toRecipients` / `ccRecipients` | recipientData |
| `subject` | subject |
| `body.content` | originalContent |
| `receivedDateTime` | sourceCreatedAt / receivedAt |
| `lastModifiedDateTime` | sourceUpdatedAt |

Initial historical import bounded by configurable `initialSyncFrom`
(30/60/90 days); SYNC and AI PROCESSING are separate stages (Spec §25–§26).
