import { getAllRows } from "./sheetsService.js";
import { CONFIG_SHEETS, GENERAL_RULES_COLUMNS, SECTION_INSTRUCTIONS_COLUMNS } from "../config/sheets.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface SectionInstruction {
  sectionKeyEn: string;
  sectionTitleHe: string;
  editingInstructions: string;
  formattingInstructions: string;
}

interface ConfigCache {
  generalRules: string;
  sections: SectionInstruction[];
  loadedAt: number;
}

let cache: ConfigCache | null = null;

async function loadGeneralRulesText(): Promise<string> {
  const rows = await getAllRows(CONFIG_SHEETS.GENERAL_RULES);
  return rows
    .map((row) => {
      const ruleType = row[GENERAL_RULES_COLUMNS.RULE_TYPE] ?? "";
      const details = row[GENERAL_RULES_COLUMNS.DETAILS] ?? "";
      const bullets = details
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `- ${line}`)
        .join("\n");
      return `# ${ruleType}\n\n${bullets}`;
    })
    .join("\n\n---\n\n");
}

async function loadSectionInstructions(): Promise<SectionInstruction[]> {
  const rows = await getAllRows(CONFIG_SHEETS.SECTION_INSTRUCTIONS);
  return rows.map((row) => ({
    sectionKeyEn: row[SECTION_INSTRUCTIONS_COLUMNS.SECTION_KEY_EN] ?? "",
    sectionTitleHe: row[SECTION_INSTRUCTIONS_COLUMNS.SECTION_TITLE_HE] ?? "",
    editingInstructions: row[SECTION_INSTRUCTIONS_COLUMNS.EDITING_INSTRUCTIONS] ?? "",
    formattingInstructions: row[SECTION_INSTRUCTIONS_COLUMNS.FORMATTING_INSTRUCTIONS] ?? "",
  }));
}

async function loadConfig(): Promise<ConfigCache> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache;
  }
  const [generalRules, sections] = await Promise.all([loadGeneralRulesText(), loadSectionInstructions()]);
  cache = { generalRules, sections, loadedAt: Date.now() };
  return cache;
}

export async function getGeneralRules(): Promise<string> {
  return (await loadConfig()).generalRules;
}

export async function getSectionInstructions(sectionKey: string): Promise<SectionInstruction | null> {
  const { sections } = await loadConfig();
  return sections.find((s) => s.sectionKeyEn === sectionKey) ?? null;
}
