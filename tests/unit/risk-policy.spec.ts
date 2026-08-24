import { describe, expect, it } from 'vitest';
import { bulkApproveDecision, classifyActionRisk } from '../../packages/domain/src/index.ts';

/**
 * P0 Closure §2 — context-aware risk matrix and bulk approve policy.
 */

describe('Context-aware risk classification (§2)', () => {
  it('routine maintenance reply at 0.95 → LOW risk, bulk approvable', () => {
    const risk = classifyActionRisk({
      actionType: 'GENERATE_REPLY',
      businessDomain: 'PROPERTY_MANAGEMENT',
      caseType: 'MAINTENANCE',
      actionRequired: 'REPLY_REQUIRED',
      priority: 'NORMAL',
    });
    expect(risk).toBe('LOW');
    expect(
      bulkApproveDecision({
        actionType: 'GENERATE_REPLY',
        riskLevel: risk,
        confidence: 0.95,
        caseType: 'MAINTENANCE',
        actionRequired: 'REPLY_REQUIRED',
      }).allowed,
    ).toBe(true);
  });

  it('offer acknowledgement at 0.99 → ≥MEDIUM risk, NOT bulk approvable', () => {
    const risk = classifyActionRisk({
      actionType: 'GENERATE_REPLY',
      businessDomain: 'SALES',
      caseType: 'OFFER',
      actionRequired: 'DECISION_REQUIRED',
      priority: 'HIGH',
    });
    expect(['MEDIUM', 'HIGH', 'CRITICAL']).toContain(risk);
    const verdict = bulkApproveDecision({
      actionType: 'GENERATE_REPLY',
      riskLevel: risk,
      confidence: 0.99,
      caseType: 'OFFER',
      actionRequired: 'DECISION_REQUIRED',
    });
    expect(verdict.allowed).toBe(false);
  });

  it('offer acceptance at 1.00 → CRITICAL risk, never bulk approvable', () => {
    const risk = classifyActionRisk({ actionType: 'OFFER_ACCEPTANCE' });
    expect(risk).toBe('CRITICAL');
    expect(
      bulkApproveDecision({
        actionType: 'OFFER_ACCEPTANCE',
        riskLevel: risk,
        confidence: 1,
      }).allowed,
    ).toBe(false);
  });

  it('legal / compliance reply at 0.98 → HIGH or above, NOT bulk approvable', () => {
    const legal = classifyActionRisk({
      actionType: 'GENERATE_REPLY',
      caseType: 'SOLICITOR',
      legalSignal: true,
    });
    expect(['HIGH', 'CRITICAL']).toContain(legal);

    const complaint = classifyActionRisk({
      actionType: 'GENERATE_REPLY',
      caseType: 'COMPLAINT',
    });
    expect(complaint).toBe('HIGH');

    for (const risk of [legal, complaint]) {
      expect(
        bulkApproveDecision({
          actionType: 'GENERATE_REPLY',
          riskLevel: risk,
          confidence: 0.98,
          caseType: 'SOLICITOR',
        }).allowed,
      ).toBe(false);
    }
  });

  it('restricted case types fail closed even with LOW risk + perfect confidence', () => {
    for (const caseType of ['OFFER', 'NEGOTIATION', 'CONTRACT', 'COMPLIANCE', 'ARREARS']) {
      const verdict = bulkApproveDecision({
        actionType: 'GENERATE_REPLY',
        riskLevel: 'LOW',
        confidence: 1,
        caseType,
      });
      expect(verdict.allowed).toBe(false);
    }
  });
});
