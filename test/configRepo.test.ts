import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SheetRef } from "../src/config/sheets.js";

vi.mock("../src/services/sheetsService.js", () => ({
  getAllRows: vi.fn(),
}));

import { getAllRows } from "../src/services/sheetsService.js";
import { CONFIG_SHEETS } from "../src/config/sheets.js";

// configRepo caches at module level, so each test gets a fresh module instance.
async function importFreshConfigRepo() {
  vi.resetModules();
  return import("../src/services/configRepo.js");
}

function mockSheets(sectionRows: Record<string, string>[]) {
  vi.mocked(getAllRows).mockImplementation(async (sheetRef: SheetRef) => {
    if (sheetRef.name === CONFIG_SHEETS.SECTION_INSTRUCTIONS.name) return sectionRows;
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
