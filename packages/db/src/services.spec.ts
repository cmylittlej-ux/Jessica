import { describe, expect, it } from 'vitest';
import { nextApprovalStatus, nextCaseStatus } from './services.ts';

/** Phase 1 Gate — pure state-machine rules, no database required. */

describe('approval state machine (Spec §27)', () => {
  it('allows PENDING to reach a decision', () => {
    expect(nextApprovalStatus('PENDING', 'APPROVED')).toBe('APPROVED');
    expect(nextApprovalStatus('PENDING', 'REJECTED')).toBe('REJECTED');
    expect(nextApprovalStatus('PENDING', 'CANCELLED')).toBe('CANCELLED');
  });

  it('rejects illegal transitions from terminal states', () => {
    expect(() => nextApprovalStatus('APPROVED', 'REJECTED')).toThrow(/Illegal/);
    expect(() => nextApprovalStatus('REJECTED', 'APPROVED')).toThrow(/Illegal/);
    expect(() => nextApprovalStatus('CANCELLED', 'APPROVED')).toThrow(/Illegal/);
  });
});

describe('case workflow status machine (Spec §6 dimension 4)', () => {
  it('follows the happy path NEW → AI_PROCESSING → READY_FOR_REVIEW → IN_PROGRESS', () => {
    expect(nextCaseStatus('NEW', 'AI_PROCESSING')).toBe('AI_PROCESSING');
    expect(nextCaseStatus('AI_PROCESSING', 'READY_FOR_REVIEW')).toBe('READY_FOR_REVIEW');
    expect(nextCaseStatus('READY_FOR_REVIEW', 'IN_PROGRESS')).toBe('IN_PROGRESS');
  });

  it('allows completion and archiving', () => {
    expect(nextCaseStatus('IN_PROGRESS', 'COMPLETED')).toBe('COMPLETED');
    expect(nextCaseStatus('COMPLETED', 'ARCHIVED')).toBe('ARCHIVED');
  });

  it('rejects skipping backwards or across the graph', () => {
    expect(() => nextCaseStatus('COMPLETED', 'NEW')).toThrow(/Illegal/);
    expect(() => nextCaseStatus('NEW', 'FOLLOW_UP_DUE')).toThrow(/Illegal/);
    expect(() => nextCaseStatus('ARCHIVED', 'IN_PROGRESS')).toThrow(/Illegal/);
  });
});
