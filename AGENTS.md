# WorkerBee — AGENTS.md

Work-log scratch pad desktop app. **Tauri v2 (Rust)** + **React 19** + **TypeScript** + **Tailwind CSS v4** + **shadcn/ui**.
Global hotkey opens a borderless floating window for quick entry. Markdown file storage. Report generation via external agent command.

## Commands

```bash
npm install                # install deps
npm run tauri dev          # dev mode (Vite HMR + Rust hot-reload)
npm run tauri build        # production build (front + Rust)
npm test                   # vitest run (only src/__tests__/**/*.test.ts)
npm run build:cli          # cargo build CLI binary + node post-process
npm run tauri:build        # build:cli + tauri build (full release pipeline)
```

- **Node** ≥ 18, **Rust stable** required.
- No ESLint/Prettier — relies on TypeScript strict mode (`tsconfig.json`).
- `npm run build` = `tsc && vite build` (typecheck then bundle; this is the `beforeBuildCommand`).

## Architecture

### Two-window model

| Window | HTML entry | React root | Created by |
|--------|-----------|------------|------------|
| **Main** | `index.html` | `src/main.tsx` → `App` | `tauri.conf.json` (declared) |
| **Quick Input** | `quick-input.html` | `src/quick-input/main.tsx` → `QuickInputApp` | `lib.rs` setup() (dynamic) |

`vite.config.ts` is a **dual-entry** build: `main` + `quick-input`.

### Cross-window communication

- Rust `emit("quick-input-shown", config)` → QuickInputApp listens, syncs theme/config
- Rust `emit("navigate-to-settings")` → App.tsx listens, switches to settings tab
- After Quick Input saves, main window refreshes via `focusChanged` event

### Views (main window)

`App.tsx` manages tab state: `"today" | "logs" | "reports" | "settings"`.

| View | Component | Notes |
|------|-----------|-------|
| Today | inline in `App.tsx` | Click-to-edit, blur-to-save, clear+blur = delete |
| Logs | `LogViewer.tsx` | Date sidebar + inline editing (similar pattern to Today) |
| Reports | `ReportsView.tsx` | ~800 lines. Select source logs → pick template → generate via agent CLI |
| Settings | inline in `App.tsx` | Theme/shortcut/locale/agent-command config |

### Key components

- **`MarkdownEditor`** — CodeMirror 6 wrapper (`@uiw/react-codemirror`), used in Reports and Templates
- **`MarkdownPreview`** — `react-markdown` + `remark-gfm` renderer
- **`TemplatesView`** — CRUD for `templates/*.md` prompt template files
- **`QuickLogDialog`** — Dialog-based quick entry (alternative to the floating window)
- **`ShortcutRecorder`** — Converts browser KeyboardEvent → Tauri shortcut string (e.g. `CommandOrControl+Shift+Space`)

## Rust ↔ TypeScript IPC

### Rust commands (`src-tauri/src/lib.rs`, ~758 lines)

| Command | Purpose |
|---------|---------|
| `get_config` / `save_config` | Config read/write; shortcut change triggers re-register |
| `get_default_storage_path` | Returns `~/.workerbee` |
| `save_log(date, time, content)` | Append entry to `logs/YYYY-MM-DD.md` |
| `read_log(date)` / `write_log(date, content)` | Full file read/write for editing |
| `list_logs` / `list_reports` | List filenames (sorted desc, no `.md` suffix) |
| `read_report` / `write_report` | Reports CRUD (`reports/` dir) |
| `list_templates` / `read_template` / `write_template` / `delete_template` | Templates CRUD (`templates/` dir) |
| `generate_report(source_files, template_name)` | Assembles prompt, pipes to `agent_command` in new terminal |
| `execute_prompt(prompt)` | Same as above but takes raw prompt string |
| `choose_folder` | Native folder picker dialog |
| `show_quick_input_cmd` / `hide_quick_input` | Show/hide floating input window |

**Adding a new command**: add `#[tauri::command]` fn in `lib.rs`, register in `invoke_handler(tauri::generate_handler![…])`, then add typed wrapper in `src/lib/api.ts`.

### TypeScript API (`src/lib/api.ts`)

Every Rust command has a typed `invoke()` wrapper here. **`AppConfig` type is the single source of truth for config shape** — keep it in sync with the Rust `AppConfig` struct.

```typescript
interface AppConfig {
  storage_path: string;
  shortcut: string;
  theme?: "light" | "dark" | "system";
  show_hint_bar?: boolean;
  locale?: string;
  agent_command?: string;  // e.g. "claude" or "cat" — piped via shell
}
```

## Prompt assembly

`src/lib/prompt.ts` exports `assemblePrompt(template, instruction, sources)` — must match Rust's `DEFAULT_PROMPT` placeholder replacement order: `{{instruction}}` first, then `{{source}}`. Sources are sorted by filename, joined with `\n\n---\n\n`, each prefixed with `# {path}\n\n`.

## Testing

- **Framework**: vitest (`npm test`)
- **Config**: `vitest.config.ts` — includes only `src/__tests__/**/*.test.ts`
- **Path alias**: `@/` configured in vitest config (mirrors tsconfig)
- **Current tests**: `src/__tests__/prompt.test.ts` (8 tests for `assemblePrompt`)

## Data layout

```
~/.workerbee/
├── .workerbee.config.json   # app config (NOT in app_data_dir)
├── logs/                    # YYYY-MM-DD.md per day
├── reports/                 # generated reports
├── templates/               # prompt templates (default.md auto-created)
└── .last-prompt.md          # most recent assembled prompt (debug artifact)
```

Log entry format:
```markdown
---
date: 2026-04-14
---

## 14:30

讨论了Q2规划

## 15:00

修复了登录bug
```

Time anchors: `## HH:mm`. `parseLogEntries()` in `src/lib/utils.ts` is the single parser.

## Conventions

- **i18n**: All UI strings use `t("section.key")` from `src/lib/i18n/`. New keys must be added to **all four** locale files: `zh-CN.json`, `en.json`, `ja.json`, `ko.json`.
- **Components**: Prefer shadcn/ui (`src/components/ui/`). Standard `forwardRef` + `cn()` pattern.
- **Styling**: CSS variables (`--color-*`), dark mode in `.dark` block, oklch color space. `@theme` block in `src/index.css`.
- **Path alias**: `@/` → `./src/` (configured in both `tsconfig.json` and `vite.config.ts`).
- **Shortcuts**: Registered and managed in **Rust only**. JS only syncs state for display.
- **Editing UX**: Click → edit, blur → save, clear content + blur → delete entry.
- **Window lifecycle**: Close main = hide to tray (not quit). Close quick-input = hide (not destroy).
- **Config defaults**: Rust uses `#[serde(default = "fn")]` for all `AppConfig` fields. Keep TS type in sync.

## Gotchas

- **`workerbee_lib`** crate name is a Windows cargo workaround (`Cargo.toml` `[lib]` name). The bin is still `workerbee`. Does not affect usage.
- **QuickInputApp has duplicate utils** (`formatCurrentTime/Date`, `applyTheme`) because it's a separate Vite entry point and can't import from `src/lib/`. Do NOT try to share these — they must stay self-contained.
- **`saveEdit()` blur handler** reads from DOM directly (not React state) to avoid stale closures from React batched updates.
- **`generate_report`** on Windows uses `CommandExt::raw_arg()` + `cmd.exe /K` — not `args()` — because MSVCRT quoting breaks pipe `|`. Any modification to this code must preserve `raw_arg`.
- **No `scripts/` directory exists** yet — `build:cli` script references `scripts/build-cli.js` which hasn't been created.
- **`ShortcutsHelpDialog`** only renders `<DialogContent>`, no outer `<Dialog>` — the caller must provide the wrapper. Do NOT nest Radix Dialogs.
- **Do not** use `setLocale("system")` — it doesn't change locale, just keeps browser-detected result.
- **`ensure_dirs`** in Rust creates `logs/`, `reports/`, `templates/` on every `save_config` call.

## Anti-patterns

- **Do not** use `as any`, `@ts-ignore`, `@ts-expect-error` to suppress type errors.
- **Do not** register/manage global shortcuts in frontend code.
- **Do not** declare quick-input window in `tauri.conf.json` — it's created dynamically in Rust.
- **Do not** add header/decoration to the quick-input window — it's a borderless floating overlay.
- **Do not** add visual zoom/scale effects to editing state — cursor only.
- **Do not** hardcode UI strings — always use `t()`.
