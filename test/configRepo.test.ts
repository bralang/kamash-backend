import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SheetRef } from "../src/config/sheets.js";

vi.mock("../src/services/sheetsService.js", () => ({
  getAllRows: vi.fn(),
}));

import { getAllRows } from "../src/services/sheetsService.js";
import { CONFIG_SHEETS } from "../src/config/sheets.js";
import { FIXED_TERMS_RULE_TYPE } from "../src/services/configRepo.js";

// configRepo caches at module level, so each test gets a fresh module instance.
async function importFreshConfigRepo() {
  vi.resetModules();
  return import("../src/services/configRepo.js");
}

function mockSheets(sectionRows: Record<string, string>[], generalRuleRows: Record<string, string>[] = []) {
  vi.mocked(getAllRows).mockImplementation(async (sheetRef: SheetRef) => {
    if (sheetRef.name === CONFIG_SHEETS.SECTION_INSTRUCTIONS.name) return sectionRows;
    if (sheetRef.name === CONFIG_SHEETS.GENERAL_RULES.name) return generalRuleRows;
    return [];
  });
}

describe("configRepo.getSectionInstructions", () => {
  beforeEach(() => {
    vi.mocked(getAllRows).mockReset();
  });

  it("returns the multi-line allowed-subheadings cell verbatim, trimmed", async () => {
    const cell = "\nקריאה:\n• חיזוק שטף הקריאה\n• דיוק בקריאה\n\nכתיבה:\n• שיפור הכתב\n  ";
    mockSheets([
      {
        "שם הסעיף באנגלית": "work_plan",
        "שם הסעיף בעברית": "תוכנית עבודה למורה",
        "הוראות עריכה": "ערוך",
        "הוראות עיצוב": "עצב",
        "כותרות משנה מותרות": cell,
      },
    ]);
    const { getSectionInstructions } = await importFreshConfigRepo();

    const instruction = await getSectionInstructions("work_plan");
    expect(instruction).not.toBeNull();
    expect(instruction?.allowedSubheadings).toBe(cell.trim());
  });

  it("returns an empty string when the column is absent from the sheet", async () => {
    mockSheets([
      {
        "שם הסעיף באנגלית": "referral_reason",
        "שם הסעיף בעברית": "סיבת הפנייה",
        "הוראות עריכה": "ערוך",
        "הוראות עיצוב": "עצב",
      },
    ]);
    const { getSectionInstructions } = await importFreshConfigRepo();

    const instruction = await getSectionInstructions("referral_reason");
    expect(instruction).not.toBeNull();
    expect(instruction?.allowedSubheadings).toBe("");
  });
});

// The clinic's term glossary is one row of the general-rules sheet, and `step1Pipeline` quotes
// it into the transcript-cleanup prompt on its own — hence a per-row accessor alongside the
// whole-rulebook one. The details cell is passed to the LLM verbatim, so nothing here reformats it.
describe("configRepo.getGeneralRule", () => {
  beforeEach(() => {
    vi.mocked(getAllRows).mockReset();
  });

  const fixedTerms = 'מכון קמ"ש; הברה / הברות (ולא "עברה"); שיכול אותיות (ולא "סיכול אותיות")';

  it("returns one rule's details cell, trimmed but otherwise verbatim", async () => {
    mockSheets(
      [],
      [
        { "סוג הכלל": "כללי לשון", "פירוט": "- תשתמש במונחים אחידים" },
        { "סוג הכלל": FIXED_TERMS_RULE_TYPE, "פירוט": `  ${fixedTerms}
` },
      ],
    );
    const { getGeneralRule } = await importFreshConfigRepo();

    expect(await getGeneralRule(FIXED_TERMS_RULE_TYPE)).toBe(fixedTerms);
  });

  it("returns an empty string when no row carries that rule type", async () => {
    mockSheets([], [{ "סוג הכלל": "כללי לשון", "פירוט": "- תשתמש במונחים אחידים" }]);
    const { getGeneralRule } = await importFreshConfigRepo();

    expect(await getGeneralRule(FIXED_TERMS_RULE_TYPE)).toBe("");
  });

  it("still folds the row into the full rulebook text", async () => {
    mockSheets([], [{ "סוג הכלל": FIXED_TERMS_RULE_TYPE, "פירוט": fixedTerms }]);
    const { getGeneralRules } = await importFreshConfigRepo();

    expect(await getGeneralRules()).toContain(`# ${FIXED_TERMS_RULE_TYPE}`);
  });
});
