import { describe, expect, it } from 'vitest';
import { classificationResultSchema } from './schemas.ts';

/** Spec §9 reference example, verbatim. */
const SPEC_EXAMPLE = {
  businessDomain: 'PROPERTY_MANAGEMENT',
  caseType: 'MAINTENANCE',
  priority: 'NORMAL',
  actionRequired: 'REPLY_REQUIRED',
  propertyId: 'property_001',
  contactId: 'contact_012',
  summaryZh: '租客报告洗碗机无法正常工作。',
  summaryEn: 'The tenant reports that the dishwasher is not working.',
  recommendedActions: [
    { type: 'REPLY_TENANT', reason: 'Acknowledge the issue and request a photo or error code.' },
    { type: 'CREATE_FOLLOW_UP', reason: 'Follow up if no response is received.' },
  ],
  confidence: 0.96,
};

describe('Structured Output schemas (Spec §9)', () => {
  it('accepts the Spec §9 reference example', () => {
    const parsed = classificationResultSchema.safeParse(SPEC_EXAMPLE);
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown enum values', () => {
    const bad = { ...SPEC_EXAMPLE, businessDomain: 'WHATEVER' };
    expect(classificationResultSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    const bad = { ...SPEC_EXAMPLE, confidence: 1.5 };
    expect(classificationResultSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects empty summaries', () => {
    const bad = { ...SPEC_EXAMPLE, summaryZh: '' };
    expect(classificationResultSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown recommended action types', () => {
    const bad = {
      ...SPEC_EXAMPLE,
      recommendedActions: [{ type: 'LAUNCH_MISSILE', reason: 'no' }],
    };
    expect(classificationResultSchema.safeParse(bad).success).toBe(false);
  });
});
