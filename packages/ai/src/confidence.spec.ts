import { describe, expect, it } from 'vitest';
import {
  confidenceBand,
  mayAutoEstablishRelationship,
  HIGH_CONFIDENCE_THRESHOLD,
  MANUAL_THRESHOLD,
} from './confidence.ts';

describe('Confidence Policy (Spec §10)', () => {
  it('bands follow the documented thresholds', () => {
    expect(confidenceBand(0.96)).toBe('HIGH');
    expect(confidenceBand(0.9)).toBe('HIGH');
    expect(confidenceBand(0.89)).toBe('NORMAL_REVIEW');
    expect(confidenceBand(0.7)).toBe('NORMAL_REVIEW');
    expect(confidenceBand(0.69)).toBe('NEEDS_MANUAL_CLASSIFICATION');
    expect(confidenceBand(0.1)).toBe('NEEDS_MANUAL_CLASSIFICATION');
  });

  it('only high confidence may auto-establish business relationships', () => {
    expect(mayAutoEstablishRelationship(0.95)).toBe(true);
    expect(mayAutoEstablishRelationship(HIGH_CONFIDENCE_THRESHOLD)).toBe(true);
    expect(mayAutoEstablishRelationship(MANUAL_THRESHOLD)).toBe(false);
    expect(mayAutoEstablishRelationship(0.5)).toBe(false);
  });
});
