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
export const LANGUAGES: { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "pt", name: "Portuguese" },
  { code: "fr", name: "French" },
  { code: "ht", name: "Haitian Creole" },
  { code: "nl", name: "Dutch" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pl", name: "Polish" },
  { code: "ro", name: "Romanian" },
  { code: "hu", name: "Hungarian" },
  { code: "bg", name: "Bulgarian" },
  { code: "cs", name: "Czech" },
  { code: "sk", name: "Slovak" },
  { code: "lv", name: "Latvian" },
  { code: "lt", name: "Lithuanian" },
  { code: "uk", name: "Ukrainian" },
  { code: "ru", name: "Russian" },
  { code: "tr", name: "Turkish" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "pa", name: "Punjabi" },
  { code: "ur", name: "Urdu" },
  { code: "bn", name: "Bengali" },
  { code: "gu", name: "Gujarati" },
  { code: "ta", name: "Tamil" },
  { code: "tl", name: "Tagalog" },
  { code: "vi", name: "Vietnamese" },
  { code: "zh", name: "Chinese" },
  { code: "ko", name: "Korean" },
  { code: "ja", name: "Japanese" },
  { code: "so", name: "Somali" },
  { code: "sw", name: "Swahili" },
  { code: "am", name: "Amharic" },
  { code: "tw", name: "Twi" },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l.name]));

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
