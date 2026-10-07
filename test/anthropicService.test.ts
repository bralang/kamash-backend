import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(() => ({ messages: { create: createMock } })),
}));

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    ANTHROPIC_API_KEY: "test-key",
    ANTHROPIC_MODEL: "claude-sonnet-5",
    ANTHROPIC_MAX_TOKENS: 4096,
    ANTHROPIC_THINKING_MAX_TOKENS: 16000,
    ANTHROPIC_EFFORT: "low",
  },
}));

vi.mock("../src/config/env.js", () => ({ config: mockConfig }));

import { rewriteSection, rewriteSnippet } from "../src/services/anthropicService.js";

const baseParams = {
  sectionText: "טקסט מקור",
  editingInstructions: "ערוך בקצרה",
  generalRules: "כללי לשון כלליים",
  patient: { name: "ילד א", age: "8", school: "בית ספר הגפן", grade: "ג", city: "בני ברק" },
};

function lastSystemPrompt(): string {
  const call = createMock.mock.calls.at(-1)?.[0];
  return call?.system ?? "";
}

describe("rewriteSection", () => {
  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({ content: [{ type: "text", text: "טקסט ערוך" }] });
  });

  it("appends the closed-list block to the system prompt when allowedSubheadings is non-empty", async () => {
    const cell = "קריאה:\n• חיזוק שטף הקריאה\n\nכתיבה:\n• שיפור הכתב";
    const result = await rewriteSection({ ...baseParams, allowedSubheadings: cell });

    expect(result).toBe("טקסט ערוך");
    const system = lastSystemPrompt();
    expect(system).toContain("כותרות משנה — רשימה סגורה וניסוחים סטנדרטיים:");
    expect(system).toContain(cell);
    expect(system).toContain("אסור להמציא כותרות משנה חדשות");
  });

  it("explains both heading levels and demands the ## marker on group headings", async () => {
    // Modelled on the real "תוכנית עבודה למורה" list, whose three groups the section-HTML
    // stage flattened to a single level in one of the two diagnoses we compared.
    const cell = [
      "## קריאה",
      "חיזוק הערוץ החזותי:",
      "• תרגול תפיסת כיוונים",
      "הקניית התנועות:",
      "• הקניית תנועה אחת בלבד",
      "",
      "## עיבוד שמיעתי",
      "מודעות פונולוגית:",
      "• חיזוק צליל פותח וצליל סוגר",
    ].join("\n");

    await rewriteSection({ ...baseParams, allowedSubheadings: cell });

    const system = lastSystemPrompt();
    expect(system).toContain(cell);
    expect(system).toContain("שורה שמתחילה ב-## היא כותרת ראשית");
    expect(system).toContain("כתוב כותרת ראשית בפלט עם הקידומת ##");
    expect(system).toContain("השמט גם אותה");
  });

  it("still describes a marker-free list as single-level, so existing sheet rows keep working", async () => {
    const flatCell = "קריאה:\n• חיזוק שטף הקריאה\n\nכתיבה:\n• שיפור הכתב";

    await rewriteSection({ ...baseParams, allowedSubheadings: flatCell });

    expect(lastSystemPrompt()).toContain("אם אין ברשימה אף שורה שמתחילה ב-##, לסעיף יש רמת כותרות אחת בלבד");
  });

  it("leaves the system prompt unchanged when allowedSubheadings is empty or whitespace", async () => {
    await rewriteSection({ ...baseParams, allowedSubheadings: "" });
    const emptySystem = lastSystemPrompt();

    await rewriteSection({ ...baseParams, allowedSubheadings: "   \n  " });
    const whitespaceSystem = lastSystemPrompt();

    expect(emptySystem).not.toContain("רשימה סגורה");
    expect(whitespaceSystem).toBe(emptySystem);
  });

  it("leaves the system prompt unchanged when allowedSubheadings is omitted", async () => {
    await rewriteSection(baseParams);

    const system = lastSystemPrompt();
    expect(system).not.toContain("רשימה סגורה");
    expect(system).toContain("הוראות עריכה:\nערוך בקצרה");
    expect(system).toContain("כללי לשון כלליים");
  });

  it("returns the text block even when claude-sonnet-5 emits a thinking block first", async () => {
    createMock.mockReset().mockResolvedValue({
      content: [
        { type: "thinking", thinking: "", signature: "abc" },
        { type: "text", text: "טקסט ערוך" },
      ],
    });

    const result = await rewriteSection(baseParams);
    expect(result).toBe("טקסט ערוך");
  });

  it("tells the model the transcript is non-native dictation and asks for a full edit, with examples", async () => {
    await rewriteSection(baseParams);

    const system = lastSystemPrompt();
    expect(system).toContain("עברית אינה שפת האם שלה");
    expect(system).toContain("המשימה היא עריכה לשונית מלאה, לא תיקון נקודתי");
    expect(system).toContain("משנים את הניסוח, לא את העובדות");
    expect(system).toContain('"נצמד לו מורת קריאה" - "הוצמדה לו מורת קריאה"');
    // Ahead of the clinic's rules, so the sheet can still narrow what the edit may do.
    expect(system.indexOf("הקשר הטקסט:")).toBeLessThan(system.indexOf("RULES:"));
  });

  it("asks for the report text only, with no notes about the edit", async () => {
    await rewriteSection(baseParams);

    const task = createMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content ?? "";
    expect(task).toContain("ללא הערות, הסברים או הצדקות על העריכה עצמה");
  });

  it("sends the request with thinking disabled", async () => {
    await rewriteSection(baseParams);

    const call = createMock.mock.calls.at(-1)?.[0];
    expect(call?.thinking).toEqual({ type: "disabled" });
  });

  it("throws an error naming stop_reason and block types when no text block is returned", async () => {
    createMock.mockReset().mockResolvedValue({
      stop_reason: "max_tokens",
      content: [{ type: "thinking", thinking: "", signature: "abc" }],
    });

    await expect(rewriteSection(baseParams)).rejects.toThrow(
      "Anthropic rewrite returned no text content (stop_reason: max_tokens, blocks: thinking)",
    );
  });
});

describe("thinking settings per model", () => {
  const snippetParams = {
    shape: "text" as const,
    content: "קטע לניסוח",
    instruction: "",
    generalRules: "כללים",
    patient: baseParams.patient,
  };

  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "טקסט ערוך" }] });
  });

  afterEach(() => {
    mockConfig.ANTHROPIC_MODEL = "claude-sonnet-5";
  });

  it("keeps claude-sonnet-5 on disabled thinking and the shared budget, on both routes", async () => {
    await rewriteSection(baseParams);
    const section = createMock.mock.calls.at(-1)?.[0];
    expect(section).toMatchObject({ thinking: { type: "disabled" }, max_tokens: 4096 });
    expect(section).not.toHaveProperty("output_config");

    await rewriteSnippet(snippetParams);
    expect(createMock.mock.calls.at(-1)?.[0]).toMatchObject({ thinking: { type: "disabled" }, max_tokens: 4096 });
  });

  // claude-sonnet-5-5 answers { type: "disabled" } with a 400, so neither route may send it.
  it("runs the section rewrite on claude-sonnet-5-5 with adaptive thinking, the effort setting and the larger budget", async () => {
    mockConfig.ANTHROPIC_MODEL = "claude-sonnet-5-5";
    await rewriteSection(baseParams);

    const call = createMock.mock.calls.at(-1)?.[0];
    expect(call).toMatchObject({
      model: "claude-sonnet-5-5",
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      max_tokens: 16000,
    });
  });

  it("runs the snippet rewrite on claude-sonnet-5-5 with between_tools and nothing else in thinking", async () => {
    mockConfig.ANTHROPIC_MODEL = "claude-sonnet-5-5";
    await rewriteSnippet(snippetParams);

    const call = createMock.mock.calls.at(-1)?.[0];
    expect(call.thinking).toEqual({ type: "between_tools" });
    expect(call).not.toHaveProperty("output_config");
    expect(call.max_tokens).toBe(4096);
  });

  it("reads the text block after an empty thinking block", async () => {
    mockConfig.ANTHROPIC_MODEL = "claude-sonnet-5-5";
    createMock.mockReset().mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "טקסט ערוך" },
      ],
    });
    await expect(rewriteSection(baseParams)).resolves.toBe("טקסט ערוך");
  });

  it("names the refusal category instead of reporting a bare missing text block", async () => {
    createMock.mockReset().mockResolvedValue({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "general_harms", explanation: "" },
      content: [],
    });
    await expect(rewriteSection(baseParams)).rejects.toThrow("declined by the model (refusal, category: general_harms)");
    await expect(rewriteSnippet(snippetParams)).rejects.toMatchObject({ statusCode: 502, code: "MODEL_ERROR" });
  });

  it("does not return text that was cut off at max_tokens", async () => {
    createMock.mockReset().mockResolvedValue({
      stop_reason: "max_tokens",
      usage: { output_tokens: 16000 },
      content: [{ type: "text", text: "טקסט שנקטע באמצע המש" }],
    });
    await expect(rewriteSection(baseParams)).rejects.toThrow("cut off at max_tokens (16000 output tokens)");
  });
});
