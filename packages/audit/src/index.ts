/**
 * @reos/audit
 *
 * Append-only audit infrastructure (Spec §2.6 Audit First, §5.12).
 * Every AI and human action must produce an AuditLog entry answering:
 * why did AI decide this / who approved / what was the original /
 * what was generated / what was edited / what was finally sent.
 *
 * AuditLog is append-only: no update, no delete, no UI editing.
 */
export const PACKAGE_NAME = '@reos/audit';
