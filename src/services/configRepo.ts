import { getAllRows } from "./sheetsService.js";
import { CONFIG_SHEETS, GENERAL_RULES_COLUMNS, SECTION_INSTRUCTIONS_COLUMNS } from "../config/sheets.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

/** The "כללי לשון" row that lists the clinic's fixed professional terms and their correct
 * spellings. It is the only general-rules row that is also fed to the transcript-cleanup
 * stage (`step1Pipeline`), so a term the clinic adds there is corrected at the first stage
 * that can see it rather than only at the per-section rewrite. Must match the sheet cell
 * verbatim — a typo here silently yields an empty glossary, not an error. */
export const FIXED_TERMS_RULE_TYPE = "מונחים קבועים";

export interface SectionInstruction {
  sectionKeyEn: string;
  sectionTitleHe: string;
  editingInstructions: string;
  formattingInstructions: string;
  /** Raw multi-line cell text (closed sub-heading list), verbatim apart from trimming — the
   * structure is passed to the prompt as-is and interpreted there, never parsed here.
   *
   * Two shapes are valid. Flat: heading lines, each followed by its bullet items (standard
   * phrasings). Grouped: the same, plus group headings prefixed with `GROUP_HEADING_MARKER`
   * ("##") that gather the headings beneath them, which the section-HTML stage renders as h3
   * over h4. A cell containing no "##" line is flat and behaves exactly as it always has, so
   * rows written before grouping existed keep working unchanged. */
  allowedSubheadings: string;
}

interface ConfigCache {
  generalRules: string;
  /** Same rows as `generalRules`, keyed by rule type and holding the untouched details cell —
   * so a single rule can be quoted into a prompt on its own. */
  generalRulesByType: Map<string, string>;
  sections: SectionInstruction[];
  loadedAt: number;
}

let cache: ConfigCache | null = null;

async function loadGeneralRules(): Promise<{ text: string; byType: Map<string, string> }> {
  const rows = await getAllRows(CONFIG_SHEETS.GENERAL_RULES);
  const byType = new Map<string, string>();
  const text = rows
    .map((row) => {
      const ruleType = row[GENERAL_RULES_COLUMNS.RULE_TYPE] ?? "";
      const details = row[GENERAL_RULES_COLUMNS.DETAILS] ?? "";
      const trimmedType = ruleType.trim();
      if (trimmedType && details.trim()) byType.set(trimmedType, details.trim());
      const bullets = details
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `- ${line}`)
        .join("\n");
      return `# ${ruleType}\n\n${bullets}`;
    })
    .join("\n\n---\n\n");
  return { text, byType };
}

async function loadSectionInstructions(): Promise<SectionInstruction[]> {
  const rows = await getAllRows(CONFIG_SHEETS.SECTION_INSTRUCTIONS);
  return rows.map((row) => ({
    sectionKeyEn: row[SECTION_INSTRUCTIONS_COLUMNS.SECTION_KEY_EN] ?? "",
    sectionTitleHe: row[SECTION_INSTRUCTIONS_COLUMNS.SECTION_TITLE_HE] ?? "",
    editingInstructions: row[SECTION_INSTRUCTIONS_COLUMNS.EDITING_INSTRUCTIONS] ?? "",
    formattingInstructions: row[SECTION_INSTRUCTIONS_COLUMNS.FORMATTING_INSTRUCTIONS] ?? "",
    allowedSubheadings: (row[SECTION_INSTRUCTIONS_COLUMNS.ALLOWED_SUBHEADINGS] ?? "").trim(),
  }));
}

async function loadConfig(): Promise<ConfigCache> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache;
  }
  const [generalRules, sections] = await Promise.all([loadGeneralRules(), loadSectionInstructions()]);
  cache = {
    generalRules: generalRules.text,
    generalRulesByType: generalRules.byType,
    sections,
    loadedAt: Date.now(),
  };
  return cache;
}

export async function getGeneralRules(): Promise<string> {
  return (await loadConfig()).generalRules;
}

/** One "כללי לשון" row's details cell, trimmed but otherwise verbatim — for prompts that need
 * a single rule rather than the whole rulebook. Returns "" when the sheet has no such row, so
 * a caller can drop the section from its prompt instead of emitting an empty heading. */
export async function getGeneralRule(ruleType: string): Promise<string> {
  return (await loadConfig()).generalRulesByType.get(ruleType.trim()) ?? "";
}

export async function getSectionInstructions(sectionKey: string): Promise<SectionInstruction | null> {
  const { sections } = await loadConfig();
  return sections.find((s) => s.sectionKeyEn === sectionKey) ?? null;
}

/** Same cached config as `getSectionInstructions`, looked up by the Hebrew title
 * instead of the English key. The assembled document carries only the Hebrew
 * title — `step1Pipeline` writes it into each `<section data-section="...">` from
 * `sectionTitleHe` — so a rewrite request originating in the editor can identify
 * its section only this way. */
export async function getSectionInstructionsByTitle(titleHe: string): Promise<SectionInstruction | null> {
  const wanted = titleHe.trim();
  if (!wanted) return null;
  const { sections } = await loadConfig();
  return sections.find((s) => s.sectionTitleHe.trim() === wanted) ?? null;
}
