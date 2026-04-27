# WorkerBee — AGENTS.md

Work-log scratch pad desktop app. **Tauri v2 (Rust)** + **React 19** + **TypeScript** + **Tailwind CSS v4** + **shadcn/ui**.
Global hotkey opens a borderless floating window for quick entry. Markdown file storage. AI-powered report generation via OpenAI-compatible API with streaming json-render UI.

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
| Reports | `ReportsView.tsx` | List/view/edit generated reports with Markdown editor |
| Settings | inline in `App.tsx` | Theme/shortcut/locale config |

### Key components

- **`MarkdownEditor`** — CodeMirror 6 wrapper (`@uiw/react-codemirror`), used in Reports
- **`MarkdownPreview`** — `react-markdown` + `remark-gfm` renderer
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
| `choose_folder` | Native folder picker dialog |
| `show_quick_input_cmd` / `hide_quick_input` | Show/hide floating input window |

**Adding a new command**: add `#[tauri::command]` fn in `lib.rs`, register in `invoke_handler(tauri::generate_handler![…])`, then add typed wrapper in `src/lib/api.ts`.

### AI Report Generation

AI-powered report generation uses `tauriFetch` (bypasses CORS) + SSE streaming + `@json-render` for real-time rendered UI.

**Key files:**

| File | Purpose |
|------|---------|
| `src/lib/ai/generate.ts` | Core streaming: `tauriFetch` → SSE parse → `createSpecStreamCompiler` → spec patches |
| `src/lib/ai/catalog.ts` | json-render catalog: 4 components (ClarifyCard, ReportPreview, ReportMeta, ActionButton) + 3 actions |
| `src/lib/ai/registry.tsx` | React component implementations for the catalog |
| `src/components/ReportsView.tsx` | Reports tab: generation toolbar + `Renderer` with `StateProvider`/`ActionProvider`/`VisibilityProvider` |
| `src/lib/api.ts` | `AI_PROVIDERS` (opencode-go / zhipu-coding-plan / custom) + `REPORT_FORMAT_PRESETS` (daily/weekly/monthly/quarterly/annual) |

**Streaming flow:**
1. User clicks Generate → `handleGenerate()` collects logs for date range
2. `generateReport()` sends `POST /chat/completions` with `stream: true` via `tauriFetch`
3. SSE chunks parsed → `parseSseDelta()` extracts `content` + `reasoning_content` (GLM models)
4. Content fed to `createSpecStreamCompiler<Spec>()` → compiled spec via JSON Patch (RFC 6902)
5. Valid specs (root element exists) trigger `setSpec()` → `<Renderer>` renders in real-time
6. Supports thinking phase display (`reasoning_content`) before formal output

**Providers:** Configured in Settings tab. `AI_PROVIDERS` in `api.ts` defines base URLs and available models. Custom provider allows arbitrary OpenAI-compatible endpoints.

**Report formats:** Built-in presets in `REPORT_FORMAT_PRESETS`. User selects in Settings. `custom` format uses `custom_report_prompt` field.

**Do NOT use AI SDK (`ai` / `@ai-sdk/openai-compatible`)** — previously tried but incompatible with `tauriFetch` streaming. Direct `tauriFetch` + manual SSE parsing is the working approach.

### TypeScript API (`src/lib/api.ts`)

Every Rust command has a typed `invoke()` wrapper here. **`AppConfig` type is the single source of truth for config shape** — keep it in sync with the Rust `AppConfig` struct.

```typescript
interface AppConfig {
  storage_path: string;
  shortcut: string;
  theme?: "light" | "dark" | "system";
  show_hint_bar?: boolean;
  locale?: string;
  ai?: AiConfig;
  report_format?: string;
  custom_report_prompt?: string;
}

interface AiConfig {
  provider: string;
  api_base_url: string;
  api_key: string;
  model: string;
}
```

## Testing

- **Framework**: vitest (`npm test`)
- **Config**: `vitest.config.ts` — includes only `src/__tests__/**/*.test.ts`
- **Path alias**: `@/` configured in vitest config (mirrors tsconfig)
- **Current tests**: none

## Data layout

```
~/.workerbee/
├── .workerbee.config.json   # app config (NOT in app_data_dir)
├── logs/                    # YYYY-MM-DD.md per day
└── reports/                 # generated reports
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
- **No `scripts/` directory exists** yet — `build:cli` script references `scripts/build-cli.js` which hasn't been created.
- **`ShortcutsHelpDialog`** only renders `<DialogContent>`, no outer `<Dialog>` — the caller must provide the wrapper. Do NOT nest Radix Dialogs.
- **Do not** use `setLocale("system")` — it doesn't change locale, just keeps browser-detected result.
- **`ensure_dirs`** in Rust creates `logs/`, `reports/` on every `save_config` call.

## Anti-patterns

- **Do not** use `as any`, `@ts-ignore`, `@ts-expect-error` to suppress type errors.
- **Do not** register/manage global shortcuts in frontend code.
- **Do not** declare quick-input window in `tauri.conf.json` — it's created dynamically in Rust.
- **Do not** add header/decoration to the quick-input window — it's a borderless floating overlay.
- **Do not** add visual zoom/scale effects to editing state — cursor only.
- **Do not** hardcode UI strings — always use `t()`.
