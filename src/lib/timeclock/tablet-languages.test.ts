import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { buildingLanguageCodes, tabletLanguages } from "./tablet-languages";
import { languageFromText, nativeLanguageName, tabletLanguagesOutcome } from "@/lib/languages";

describe("a building's languages", () => {
  it("puts the main one first and drops repeats and unknown codes", () => {
    expect(buildingLanguageCodes({ primaryLanguage: "en", additionalLanguages: ["es", "en", "xx", "pl"] })).toEqual(["en", "es", "pl"]);
    expect(buildingLanguageCodes({ primaryLanguage: null, additionalLanguages: [] })).toEqual([]);
    expect(buildingLanguageCodes(null)).toEqual([]);
  });
});

describe("what the tablet is told", () => {
  it("asks only someone with no language, where there is a choice", () => {
    expect(tabletLanguages(null, ["en", "es"])).toEqual({
      language: null,
      languages: [{ code: "en", name: "English" }, { code: "es", name: "Español" }],
      askLanguage: true,
    });
    expect(tabletLanguages("es", ["en", "es"]).askLanguage).toBe(false);
    expect(tabletLanguages(null, ["en"]).askLanguage).toBe(false);
    expect(tabletLanguages(null, []).askLanguage).toBe(false);
  });

  it("keeps a saved language the building does not offer, for any building", () => {
    expect(tabletLanguages("pl", ["en", "es"]).language).toBe("pl");
  });

  it("ignores a saved value that is not a language", () => {
    expect(tabletLanguages("klingon", ["en", "es"])).toMatchObject({ language: null, askLanguage: true });
  });
});

describe("language names", () => {
  it("names each language in itself, and reads what HR types", () => {
    expect(nativeLanguageName("nl")).toBe("Nederlands");
    expect(languageFromText("Spanish")).toBe("es");
    expect(languageFromText("español")).toBe("es");
    expect(languageFromText(" ES ")).toBe("es");
    expect(languageFromText("Elvish")).toBeNull();
  });

  it("says what the building's tablets do in one sentence", () => {
    expect(tabletLanguagesOutcome(null, [])).toMatch(/offer no choice/);
    expect(tabletLanguagesOutcome("en", [])).toBe("Tablets here show English. Nobody is asked to choose.");
    expect(tabletLanguagesOutcome("nl", ["en", "pl"])).toBe(
      "Tablets here show Dutch, and offer Dutch, English and Polish to anyone with no language saved. Anyone with one saved always sees their own.",
    );
  });
});
