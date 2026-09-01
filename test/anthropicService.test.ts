import { describe, it, expect, vi, beforeEach } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(() => ({ messages: { create: createMock } })),
}));

vi.mock("../src/config/env.js", () => ({
  config: { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_MODEL: "claude-sonnet-5", ANTHROPIC_MAX_TOKENS: 4096 },
}));

import { rewriteSection } from "../src/services/anthropicService.js";

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
