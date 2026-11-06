/**
 * The languages a site can work in and a person can prefer. Informational for
 * now (a site's primary and other languages, a person's preferred one), kept
 * as language codes (BCP 47) so the tablets, messages and documents can use
 * them as they are later.
 *
 * <p>The list is the languages spoken across the buildings: the US sites,
 * Canada and the Netherlands. A code not on it (one added later and then
 * removed from here) still shows, by its code.
 */
/**
 * `native` is the language's name in itself, for a choice the person makes
 * in their own language (the time clock's language buttons).
 */
export const LANGUAGES: { code: string; name: string; native: string }[] = [
  { code: "en", name: "English", native: "English" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "fr", name: "French", native: "Français" },
  { code: "ht", name: "Haitian Creole", native: "Kreyòl ayisyen" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "ro", name: "Romanian", native: "Română" },
  { code: "hu", name: "Hungarian", native: "Magyar" },
  { code: "bg", name: "Bulgarian", native: "Български" },
  { code: "cs", name: "Czech", native: "Čeština" },
  { code: "sk", name: "Slovak", native: "Slovenčina" },
  { code: "lv", name: "Latvian", native: "Latviešu" },
  { code: "lt", name: "Lithuanian", native: "Lietuvių" },
  { code: "uk", name: "Ukrainian", native: "Українська" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "ur", name: "Urdu", native: "اردو" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "tl", name: "Tagalog", native: "Tagalog" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt" },
  { code: "zh", name: "Chinese", native: "中文" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "so", name: "Somali", native: "Soomaali" },
  { code: "sw", name: "Swahili", native: "Kiswahili" },
  { code: "am", name: "Amharic", native: "አማርኛ" },
  { code: "tw", name: "Twi", native: "Twi" },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l.name]));

/**
 * Whether the tablet app in the buildings already reads a person's language
 * and the building's list (TABLET-LANGUAGES-PLAN.md). CloudTime sends them
 * either way; until the tablet app's update is out, Sites says so instead of
 * promising what the tablets do not do yet. Set to true when it ships.
 */
export const TABLETS_USE_LANGUAGES = false;

/** What a building's tablets do with its languages, in one sentence for Sites. */
export function tabletLanguagesOutcome(primary: string | null | undefined, others: readonly string[]): string {
  const list = [...(primary ? [primary] : []), ...others.filter((c) => c && c !== primary)].map(languageName);
  const and = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
  if (list.length === 0) return "Tablets here show their usual language and offer no choice.";
  if (list.length === 1) return `Tablets here show ${list[0]}. Nobody is asked to choose.`;
  return `Tablets here show ${list[0]}, and offer ${and(list)} to anyone with no language saved. Anyone with one saved always sees their own.`;
}

const NATIVE_BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l.native]));

/** A language's name in itself ("Español"), or its code when it is not on the list. */
export function nativeLanguageName(code: string): string {
  return NATIVE_BY_CODE.get(code) ?? code;
}

/** A language from what someone typed: its code, its English name or its own name, any case. */
export function languageFromText(text: string | null | undefined): string | null {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return null;
  const hit = LANGUAGES.find((l) => l.code === t || l.name.toLowerCase() === t || l.native.toLowerCase() === t);
  return hit?.code ?? null;
}

/** Whether a code is one of the languages offered. */
export function isLanguageCode(code: string): boolean {
  return BY_CODE.has(code);
}

/** A language's name, or its code when it is not on the list. */
export function languageName(code: string | null | undefined): string {
  if (!code) return "";
  return BY_CODE.get(code) ?? code;
}

/**
 * A site's languages as they are kept: the other languages without blanks,
 * repeats, codes not on the list, or the primary one again.
 */
export function cleanLanguages(primary: string | null | undefined, others: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>(primary ? [primary] : []);
  const out: string[] = [];
  for (const code of others ?? []) {
    const c = code.trim();
    if (!c || seen.has(c) || !isLanguageCode(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}
