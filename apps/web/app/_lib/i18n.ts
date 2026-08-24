import { cookies } from "next/headers";
import { getDict, type DictKey, type Lang } from "./dictionary";

/**
 * Server-side language resolution (Spec §25). The language lives in a cookie
 * only — switching UI language never touches business tables, which is how
 * the Phase 6 gate ("language switch must not break business state") is met
 * by construction.
 */
export const LANG_COOKIE = "reos_lang";

export async function getLang(): Promise<Lang> {
  const store = await cookies();
  return store.get(LANG_COOKIE)?.value === "zh" ? "zh" : "en";
}

export type T = Record<DictKey, string>;

/** Convenience: resolve lang and dict in one call for server components. */
export async function getI18n(): Promise<{ lang: Lang; t: T }> {
  const lang = await getLang();
  return { lang, t: getDict(lang) };
}

export { fmt } from "./dictionary";
export type { Lang, DictKey } from "./dictionary";
