import { describe, expect, it } from 'vitest';
import { classificationResultSchema } from './schemas.ts';
import { createMockAIProvider } from './provider.ts';

const maintenanceEmail = {
  subject: 'Dishwasher not working',
  content:
    'Hi, the dishwasher at the property is not working and there is a small leak under the sink. Could someone please arrange a repair?',
};

describe('MockAIProvider', () => {
  it('classifies maintenance emails with high confidence', async () => {
    const provider = createMockAIProvider();
    const result = await provider.complete({
      task: 'CLASSIFY_COMMUNICATION',
      tier: 'TIER_2',
      systemPrompt: 'test',
      input: maintenanceEmail,
      schema: classificationResultSchema,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.businessDomain).toBe('PROPERTY_MANAGEMENT');
    expect(result.value.caseType).toBe('MAINTENANCE');
    expect(result.value.priority).toBe('HIGH'); // two keyword hits
    expect(result.value.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('returns low confidence for unrecognised content (human fallback)', async () => {
    const provider = createMockAIProvider();
    const result = await provider.complete({
      task: 'CLASSIFY_COMMUNICATION',
      tier: 'TIER_2',
      systemPrompt: 'test',
      input: { subject: 'Hello', content: 'Just saying hi to the team.' },
      schema: classificationResultSchema,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.caseType).toBe('OTHER_ADMIN');
    expect(result.value.confidence).toBeLessThan(0.7);
  });

  it('is deterministic — same input, same output', async () => {
    const run = async () => {
      const provider = createMockAIProvider();
      const r = await provider.complete({
        task: 'CLASSIFY_COMMUNICATION',
        tier: 'TIER_2',
        systemPrompt: 'test',
        input: maintenanceEmail,
        schema: classificationResultSchema,
      });
      return JSON.stringify(r);
    };
    expect(await run()).toBe(await run());
  });

  it('supports fixedConfidence override for the Low-Confidence E2E (§34)', async () => {
    const provider = createMockAIProvider({ fixedConfidence: 0.42 });
    const result = await provider.complete({
      task: 'CLASSIFY_COMMUNICATION',
      tier: 'TIER_2',
      systemPrompt: 'test',
      input: maintenanceEmail,
      schema: classificationResultSchema,
    });
    expect(result.ok && result.value.confidence === 0.42).toBe(true);
  });

  it('records which tier each task ran on', async () => {
    const provider = createMockAIProvider();
    await provider.complete({
      task: 'CLASSIFY_COMMUNICATION',
      tier: 'TIER_2',
      systemPrompt: 't',
      input: maintenanceEmail,
      schema: classificationResultSchema,
    });
    expect(provider.calls[0]).toEqual({ task: 'CLASSIFY_COMMUNICATION', tier: 'TIER_2' });
  });
});
