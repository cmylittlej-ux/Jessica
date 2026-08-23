import { describe, expect, it } from 'vitest';
import { tierForTask, TASK_TIERS } from './tiers.ts';

describe('Model tier abstraction (Spec §11)', () => {
  it('maps every task to a defined tier', () => {
    expect(tierForTask('CLASSIFY_COMMUNICATION')).toBe('TIER_2');
    expect(tierForTask('TRANSLATE')).toBe('TIER_1');
    expect(tierForTask('GENERATE_REPLY')).toBe('TIER_2');
    for (const task of Object.keys(TASK_TIERS) as Array<keyof typeof TASK_TIERS>) {
      expect(TASK_TIERS[task]).toMatch(/^TIER_[0-3]$/);
    }
  });
});
