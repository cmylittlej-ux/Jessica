import { describe, expect, it } from "vitest";
import { getDict } from "../../apps/web/app/_lib/dictionary.ts";

/**
 * Phase 6 guard: the en/zh UI dictionaries must define identical key sets so
 * switching language can never render a missing label.
 */
describe("UI dictionary parity", () => {
  const en = getDict("en");
  const zh = getDict("zh");

  it("zh defines exactly the same keys as en", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it("no value is empty in either language", () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim().length, `en:${k}`).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(zh)) expect(v.trim().length, `zh:${k}`).toBeGreaterThan(0);
  });
});
