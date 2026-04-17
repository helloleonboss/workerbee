import { describe, it, expect } from "vitest";
import {
  assemblePrompt,
  FALLBACK_DEFAULT_TEMPLATE,
} from "@/lib/prompt";

describe("assemblePrompt", () => {
  it("assembles a prompt with basic instruction and sources", () => {
    const template = "INST: {{instruction}}\nSRC: {{source}}";
    const result = assemblePrompt(template, "Summarize", [
      ["logs/2026-04-14.md", "Did some work"],
    ]);
    expect(result).toBe(
      "INST: Summarize\nSRC: # logs/2026-04-14.md\n\nDid some work",
    );
  });

  it("sorts sources by filename before concatenation", () => {
    const template = "{{source}}";
    const result = assemblePrompt(template, "", [
      ["logs/2026-04-15.md", "Later"],
      ["logs/2026-04-13.md", "Earlier"],
      ["logs/2026-04-14.md", "Middle"],
    ]);
    expect(result).toBe(
      "# logs/2026-04-13.md\n\nEarlier\n\n---\n\n# logs/2026-04-14.md\n\nMiddle\n\n---\n\n# logs/2026-04-15.md\n\nLater",
    );
  });

  it("handles empty instruction", () => {
    const template = "Before{{instruction}}After\n{{source}}";
    const result = assemblePrompt(template, "", [
      ["a.md", "content"],
    ]);
    expect(result).toBe("BeforeAfter\n# a.md\n\ncontent");
  });

  it("handles empty sources array", () => {
    const template = "I:{{instruction}}\nS:{{source}}";
    const result = assemblePrompt(template, "Do stuff", []);
    expect(result).toBe("I:Do stuff\nS:");
  });

  it("leaves placeholders intact when template has no matching placeholders", () => {
    const template = "No placeholders here";
    const result = assemblePrompt(template, "ignored", [
      ["x.md", "also ignored"],
    ]);
    expect(result).toBe("No placeholders here");
  });

  it("handles special characters in instruction and source content", () => {
    const template = "{{instruction}}\n{{source}}";
    const result = assemblePrompt(template, "$100 < bucks > & 'quotes'", [
      ["path/with spaces.md", "line1\nline2\nline3"],
    ]);
    expect(result).toBe(
      "$100 < bucks > & 'quotes'\n# path/with spaces.md\n\nline1\nline2\nline3",
    );
  });

  it("integrates with FALLBACK_DEFAULT_TEMPLATE", () => {
    const result = assemblePrompt(
      FALLBACK_DEFAULT_TEMPLATE,
      "请使用中文输出",
      [["logs/2026-04-14.md", "## 09:00\n\n开会讨论"]],
    );
    expect(result).toContain("请使用中文输出");
    expect(result).toContain("# logs/2026-04-14.md");
    expect(result).toContain("开会讨论");
    expect(result).toContain("# 任务");
    expect(result).toContain("# 输入内容");
    expect(result).not.toContain("{{instruction}}");
    expect(result).not.toContain("{{source}}");
  });

  it("uses \\n\\n---\\n\\n separator between multiple sources", () => {
    const template = "{{source}}";
    const result = assemblePrompt(template, "", [
      ["b.md", "B"],
      ["a.md", "A"],
    ]);
    expect(result).toBe("# a.md\n\nA\n\n---\n\n# b.md\n\nB");
  });
});
