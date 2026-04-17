/**
 * Must match Rust DEFAULT_PROMPT at src-tauri/src/lib.rs:32-41 exactly.
 */
export const FALLBACK_DEFAULT_TEMPLATE = `# 任务

你是一个工作日报生成助手。请根据以下工作日志生成一份专业的工作日报。

{{instruction}}

# 输入内容

{{source}}
`;

/**
 * Assemble a prompt string by replacing placeholders in a template.
 *
 * Sources are sorted by filename and concatenated with `\\n\\n---\\n\\n`,
 * each prefixed with `# {path}\\n\\n`.
 *
 * Replacement order: {{instruction}} first, then {{source}} — matching
 * Rust behaviour at lib.rs:382-384.
 */
export function assemblePrompt(
  template: string,
  instruction: string,
  sources: [string, string][],
): string {
  const sorted = [...sources].sort((a, b) => a[0].localeCompare(b[0]));

  const sourceBlock = sorted
    .map(([path, content]) => `# ${path}\n\n${content}`)
    .join("\n\n---\n\n");

  return template
    .replace("{{instruction}}", instruction)
    .replace("{{source}}", sourceBlock);
}
