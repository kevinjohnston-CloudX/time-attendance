import { describe, expect, it } from "vitest";
import { cleanLanguages, isLanguageCode, languageName } from "./languages";

describe("languages", () => {
  it("names a code, and shows a code it does not know as it is", () => {
    expect(languageName("es")).toBe("Spanish");
    expect(languageName("ht")).toBe("Haitian Creole");
    expect(languageName("xx")).toBe("xx");
    expect(languageName(null)).toBe("");
    expect(isLanguageCode("nl")).toBe(true);
    expect(isLanguageCode("Spanish")).toBe(false);
  });

  it("keeps a site's other languages without blanks, repeats, unknown codes or the primary again", () => {
    expect(cleanLanguages("es", ["en", "", "es", "pt", "en", "xx", " fr "])).toEqual(["en", "pt", "fr"]);
    expect(cleanLanguages(null, ["es", "en"])).toEqual(["es", "en"]);
    expect(cleanLanguages("en", undefined)).toEqual([]);
  });
});
