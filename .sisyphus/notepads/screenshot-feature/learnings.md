## [2026-04-21] Learning: Subagent Failure

### Issue
Subagents using `task()` with category `quick` failed to execute file modifications. All three Wave 1 tasks (T1, T2, T3) reported "No file changes detected" despite claiming completion.

### Root Cause
`Sisyphus-Junior` subagents with `category: "quick"` are **analysis-only agents** — they produce recommendations but do not invoke Edit/Write/Bash tools to make changes. They treat implementation tasks as analysis requests.

### Solution
Execute tasks directly in the orchestrator session when subagents fail. For this plan:
- Wave 1 (T1-T3): Direct execution ✅
- T4 (Rust commands): Direct execution ✅
- Wave 2 (T5-T7): Direct execution (in progress)
- Wave 3 (T8-T10): Direct execution (planned)

### Pattern
When `task()` returns "No file changes detected" repeatedly:
1. Verify with `git diff --stat` and `git status`
2. Read modified files directly
3. If no changes found, execute directly in orchestrator session

### Reference
Oracle diagnosis session (ses_25066a98dffee4c7GPribZYv2A) confirmed this behavior.

## [2026-04-22] T10: Screenshot Inline Rendering in Today + LogViewer

### Approach
Created `InlineEntryContent` component (shared between TodayView and LogViewer) that uses ReactMarkdown with a custom `img` component to render screenshots inline instead of raw markdown text.

### Key Decisions
- **Separate component from MarkdownPreview**: MarkdownPreview wraps content in ScrollArea + has its own styles. InlineEntryContent is lightweight, no ScrollArea, minimal styling via Tailwind arbitrary variants.
- **Image path resolution**: `../screenshots/xxx.webp` → strip `../` prefix → `{storagePath}/screenshots/xxx.webp` → `convertFileSrc()`. The `resolveImagePath()` function handles this.
- **Lightbox per component instance**: Each InlineEntryContent has its own Dialog-based lightbox. Since only one entry's lightbox is open at a time, this is efficient enough.
- **Click-to-edit preserved**: `e.stopPropagation()` on image clicks prevents triggering the parent div's `onClick` → `startEdit()`. Non-image clicks still bubble up normally.
- **LogViewer needs storagePath prop**: Added `storagePath: string` to `LogViewerProps`. App.tsx passes `config.storage_path` when rendering LogViewer.

### Files Modified
- `src/components/InlineEntryContent.tsx` — NEW: shared inline markdown+image renderer with lightbox
- `src/App.tsx` — import InlineEntryContent, replace `<p>` in TodayView display state, pass storagePath to LogViewer
- `src/components/LogViewer.tsx` — add storagePath prop, import InlineEntryContent, replace `<p>` in display state

### Verification
- `npx tsc --noEmit` passes (no errors)
- `cargo check` passes (pre-existing warnings only)
- LSP diagnostics clean on all 3 modified files

## [2026-04-22] Fix: Screenshot overlay race condition (push→pull)

### Problem
`show_screenshot_overlay` captured screen → emitted `screenshot-overlay-ready` event → but overlay JS hadn't loaded yet → event lost → overlay stuck on "加载截图中..." forever (fullscreen + always-on-top = app frozen).

### Fix
Changed from **push** (Rust emits event → overlay listens) to **pull** (overlay requests data when ready via `invoke`).

### Changes
- **lib.rs**: Added `ScreenshotOverlayData` struct + `ScreenshotOverlayDataState` managed state. `show_screenshot_overlay` now stores data in state instead of emitting event. New `get_screenshot_overlay_data` command with `.take()` (one-time read). `cancel_screenshot` clears overlay data too.
- **screenshot-overlay/main.tsx**: Replaced `listen("screenshot-overlay-ready", ...)` with `invoke("get_screenshot_overlay_data")`. Removed unused `listen` import. Error handler calls `cancel_screenshot` to close overlay gracefully.

### Rust Lifetime Gotcha
`state.0.lock().unwrap().take().ok_or(...)` fails — the `MutexGuard` temporary outlives the borrow. Fix: extract into a `let data = ...;` binding first, then `data.ok_or(...)`.

### Verification
- `npx tsc --noEmit` — passes
- `cargo check` — passes (only pre-existing unused variable warning)

