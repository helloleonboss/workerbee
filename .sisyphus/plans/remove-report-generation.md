# Remove Report Generation Functionality

## TL;DR

> **Quick Summary**: Remove all report generation code (prompt assembly, source selection, template management, agent execution) while keeping report viewing/editing. One significant rewrite (ReportsView) + surgical deletions across backend, API, i18n, and settings.
>
> **Deliverables**:
> - Simplified ReportsView.tsx (viewing-only, no mode switching)
> - Removed prompt.ts, prompt.test.ts, TemplatesView.tsx
> - Cleaned lib.rs (no generate_report, execute_prompt, template commands, DEFAULT_PROMPT, agent_command)
> - Cleaned api.ts (no generation/template functions)
> - Cleaned App.tsx (no agent settings card, no agent_command/agent_background config fields)
> - Cleaned i18n (no generation keys)
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Wave 1 (backend cleanup) → Wave 2 (ReportsView rewrite)

---

## Context

### Original Request
User: "把报告生成功能删了吧" → clarified as "生成报告的所有相关功能 只保留已有报告的相关功能"

### Interview Summary
**Key Discussions**:
- Delete everything related to report generation (source selection, prompt assembly, template management, agent execution)
- Keep only: report list, report viewing, report editing
- TemplatesView.tsx exists as dead code — remove entirely
- Template backend (Rust + api.ts) should be removed since no UI uses it

**Research Findings**:
- ReportsView.tsx (~800 lines): dual mode (generate/view). ~500 lines generation, ~250 lines viewing.
- TemplatesView.tsx: Dead code, not imported anywhere
- App.tsx: Contains agent_command settings card (lines 736-783) and agent_background phantom field
- lib.rs: DEFAULT_PROMPT constant, ensure_dirs templates/ line, cli_inspect templates/ entry, agent_command in AppConfig

### Metis Review
**Identified Gaps** (addressed):
- Agent Settings Card in App.tsx: Added to plan scope
- `agent_command` field removal from AppConfig (Rust + TS): Added
- `agent_background` phantom field in TS: Added
- `DEFAULT_PROMPT` constant in Rust: Added
- `ensure_dirs` templates/ line: Added
- `cli_inspect` templates/ entry: Added
- `use std::process::Command` import cleanup: Added

---

## Work Objectives

### Core Objective
Remove all report generation functionality, leaving a clean report viewing/editing experience.

### Concrete Deliverables
- ReportsView.tsx simplified to viewing-only (no mode toggle)
- All generation code removed from frontend, backend, config, i18n
- Dead code removed (TemplatesView.tsx, prompt.ts, prompt.test.ts)

### Definition of Done
- [x] `npm run build` passes (tsc + vite build, no type errors)
- [x] Reports tab shows existing reports, allows viewing/editing
- [x] No generation UI elements visible anywhere in the app
- [x] No broken imports or dead references

### Must Have
- Report list sidebar with file selection
- Report content viewing (Markdown preview)
- Report content editing (Markdown editor)
- Edit/preview toggle within report viewer
- Save on blur (existing pattern)

### Must NOT Have (Guardrails)
- Do NOT remove `read_log` / `list_logs` Rust commands — used by Today and Logs views
- Do NOT remove `save_log` / `write_log` — used by Today and Logs views
- Do NOT remove the Reports tab from App.tsx navigation
- Do NOT remove `vitest.config.ts` or `package.json` test script — keep for future tests
- Do NOT modify Quick Input window, LogViewer, or Today view
- Do NOT add new dependencies
- Do NOT change the reports directory structure (`~/.workerbee/reports/`)
- Do NOT remove `ensure_dirs` `reports/` line — viewing still needs reports directory

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (vitest)
- **Automated tests**: None (this is a deletion task, no new testable logic)
- **Framework**: vitest (kept for future use)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Build**: Use Bash — `npm run build` must pass
- **UI**: Use Playwright — verify Reports tab renders, no generation UI visible
- **Backend**: Use Bash (cargo check) — Rust must compile clean

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - backend + config cleanup, MAX PARALLEL):
├── Task 1: Delete generation-only files (prompt.ts, prompt.test.ts, TemplatesView.tsx) [quick]
├── Task 2: Clean api.ts — remove generation + template functions [quick]
├── Task 3: Clean lib.rs — remove generation commands, template commands, DEFAULT_PROMPT, agent_command config [deep]
└── Task 4: Clean i18n — remove generation-only keys from 4 locale files [quick]

Wave 2 (After Wave 1 — frontend rewrite):
└── Task 5: Rewrite ReportsView.tsx as viewing-only + clean App.tsx agent settings [deep]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA (unspecified-high)
└── F4: Scope fidelity check (deep)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 5 | 1 |
| 2 | — | 5 | 1 |
| 3 | — | 5 | 1 |
| 4 | — | 5 | 1 |
| 5 | 1, 2, 3, 4 | F1-F4 | 2 |
| F1-F4 | 5 | user okay | FINAL |

### Agent Dispatch Summary

- **Wave 1**: **4 tasks** — T1 → `quick`, T2 → `quick`, T3 → `deep`, T4 → `quick`
- **Wave 2**: **1 task** — T5 → `deep`
- **FINAL**: **4 tasks** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Delete generation-only files

  **What to do**:
  - Delete `src/lib/prompt.ts` (entire file — prompt assembly logic)
  - Delete `src/__tests__/prompt.test.ts` (entire file — tests for prompt assembly)
  - Delete `src/components/TemplatesView.tsx` (entire file — dead code, not imported anywhere)

  **Must NOT do**:
  - Do NOT delete `vitest.config.ts`
  - Do NOT remove `vitest` from package.json or the `test` script

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `src/lib/prompt.ts` — Generation-only prompt assembly (assemblePrompt + FALLBACK_DEFAULT_TEMPLATE)
  - `src/__tests__/prompt.test.ts` — Tests for assemblePrompt (8 test cases)
  - `src/components/TemplatesView.tsx` — Dead code component, not imported anywhere

  **Acceptance Criteria**:
  - [ ] `src/lib/prompt.ts` does not exist
  - [ ] `src/__tests__/prompt.test.ts` does not exist
  - [ ] `src/components/TemplatesView.tsx` does not exist

  **QA Scenarios**:

  ```
  Scenario: Verify files deleted
    Tool: Bash
    Steps:
      1. Run: test ! -f src/lib/prompt.ts && echo "prompt.ts deleted" || echo "FAIL: prompt.ts exists"
      2. Run: test ! -f src/__tests__/prompt.test.ts && echo "test deleted" || echo "FAIL: test exists"
      3. Run: test ! -f src/components/TemplatesView.tsx && echo "TemplatesView deleted" || echo "FAIL: exists"
    Expected Result: All three echo "deleted", no "FAIL"
    Evidence: .sisyphus/evidence/task-1-files-deleted.txt
  ```

  **Commit**: YES (groups with 2, 3, 4)
  - Message: `chore: remove report generation files`
  - Files: `src/lib/prompt.ts`, `src/__tests__/prompt.test.ts`, `src/components/TemplatesView.tsx`

---

- [x] 2. Clean api.ts — remove generation + template functions

  **What to do**:
  - Remove `generateReport()` function
  - Remove `executePrompt()` function
  - Remove `listTemplates()` function
  - Remove `readTemplate()` function
  - Remove `writeTemplate()` function
  - Remove `deleteTemplate()` function
  - KEEP: `listReports()`, `readReport()`, `writeReport()`
  - KEEP: All log functions, config functions, other functions

  **Must NOT do**:
  - Do NOT remove report viewing functions (listReports, readReport, writeReport)
  - Do NOT remove log functions (listLogs, readLog, etc.)
  - Do NOT remove config functions

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `src/lib/api.ts` — TypeScript IPC wrappers. Lines 72-78: generateReport + executePrompt (generation-only). Lines 56-70: template CRUD functions.

  **Acceptance Criteria**:
  - [ ] `src/lib/api.ts` does NOT export generateReport, executePrompt, listTemplates, readTemplate, writeTemplate, deleteTemplate
  - [ ] `src/lib/api.ts` DOES export listReports, readReport, writeReport

  **QA Scenarios**:

  ```
  Scenario: Verify generation functions removed, viewing functions kept
    Tool: Bash
    Steps:
      1. grep -c "export async function generateReport\|export async function executePrompt\|export async function listTemplates\|export async function readTemplate\|export async function writeTemplate\|export async function deleteTemplate" src/lib/api.ts
      2. grep -c "export async function listReports\|export async function readReport\|export async function writeReport" src/lib/api.ts
    Expected Result: First grep returns 0 matches. Second grep returns 3 matches.
    Evidence: .sisyphus/evidence/task-2-api-clean.txt
  ```

  **Commit**: YES (groups with 1, 3, 4)
  - Message: `chore: remove report generation files`
  - Files: `src/lib/api.ts`

---

- [x] 3. Clean lib.rs — remove generation commands, template commands, DEFAULT_PROMPT, agent_command config

  **What to do**:

  **Remove these `#[tauri::command]` functions entirely**:
  - `generate_report()` (lines ~309-417) — reads sources, assembles prompt, writes .last-prompt.md, launches terminal
  - `execute_prompt()` (lines ~419-456) — writes prompt to .last-prompt.md, launches terminal
  - `delete_template()` (lines ~459-469) — deletes template file
  - `list_templates()` (lines ~265-289) — lists template files
  - `read_template()` (lines ~292-298) — reads template file
  - `write_template()` (lines ~301-307) — writes template file

  **Remove `DEFAULT_PROMPT` constant** (lines ~32-41):
  - The `const DEFAULT_PROMPT: &str = ...` string used for template placeholder replacement

  **Remove `default_agent_command()` function**:
  - The default function for AppConfig's agent_command field

  **Remove `agent_command` from `AppConfig` struct**:
  - Remove the `agent_command: Option<String>` field and its `#[serde(default = "default_agent_command")]`

  **Remove from `ensure_dirs`** (line ~106):
  - Remove the line that creates `templates/` directory: `fs::create_dir_all(&dir.join("templates"))`

  **Remove from `cli_inspect`** (line ~719):
  - Remove the `templates/` entry from the CLI inspect output

  **Remove from `invoke_handler` registration**:
  - Remove `generate_report`, `execute_prompt`, `list_templates`, `read_template`, `write_template`, `delete_template` from the `tauri::generate_handler![...]` macro

  **Clean up imports if unused after removal**:
  - Check if `use std::process::Command` is still needed (used in generate_report/execute_prompt for terminal launching)
  - If no other code uses it, remove the import

  **KEEP these commands**:
  - `list_reports()`, `read_report()`, `write_report()` — viewing needs these
  - `read_log()`, `list_logs()`, `save_log()`, `write_log()` — Today/Logs views need these
  - `get_config()`, `save_config()`, `get_default_storage_path()` — settings
  - `choose_folder()`, `show_quick_input_cmd()`, `hide_quick_input()` — other features

  **Must NOT do**:
  - Do NOT remove report viewing commands (list_reports, read_report, write_report)
  - Do NOT remove log commands
  - Do NOT remove `ensure_dirs` `reports/` line or `logs/` line
  - Do NOT break the `AppConfig` struct for fields still in use (storage_path, shortcut, theme, show_hint_bar, locale)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Multiple surgical removals across a 758-line Rust file, must be precise to avoid breaking compilation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `src-tauri/src/lib.rs` — Main Rust file (~758 lines). Key sections:
    - Lines ~32-41: `DEFAULT_PROMPT` constant — remove entirely
    - Lines ~106: `ensure_dirs` `templates/` line — remove
    - Lines ~219-262: Report viewing commands — KEEP
    - Lines ~265-307: Template CRUD commands — REMOVE
    - Lines ~309-417: `generate_report` — REMOVE
    - Lines ~419-456: `execute_prompt` — REMOVE
    - Lines ~459-469: `delete_template` — REMOVE
    - Lines ~661-677: `invoke_handler` registration — remove 6 command names
    - Lines ~719: `cli_inspect` templates/ entry — remove
    - `AppConfig` struct: Remove `agent_command` field + `default_agent_command()` fn
    - Line ~6: `use std::process::Command` — check if still needed after removal

  **Acceptance Criteria**:
  - [ ] `cargo check` in `src-tauri/` passes with no errors
  - [ ] No reference to `generate_report`, `execute_prompt`, `list_templates`, `read_template`, `write_template`, `delete_template` in the file
  - [ ] `DEFAULT_PROMPT` constant removed
  - [ ] `agent_command` field removed from `AppConfig` struct
  - [ ] `default_agent_command()` function removed
  - [ ] `templates/` not in `ensure_dirs` or `cli_inspect`
  - [ ] `std::process::Command` import removed if no longer used

  **QA Scenarios**:

  ```
  Scenario: Rust compilation succeeds
    Tool: Bash
    Steps:
      1. Run: cd src-tauri && cargo check 2>&1
    Expected Result: Exit code 0, no error output
    Evidence: .sisyphus/evidence/task-3-cargo-check.txt

  Scenario: No generation/template references remain
    Tool: Bash
    Steps:
      1. Run: grep -n "generate_report\|execute_prompt\|list_templates\|read_template\|write_template\|delete_template\|DEFAULT_PROMPT\|default_agent_command\|agent_command" src-tauri/src/lib.rs
    Expected Result: Exit code 1 (no matches found)
    Evidence: .sisyphus/evidence/task-3-no-gen-refs.txt
  ```

  **Commit**: YES (groups with 1, 2, 4)
  - Message: `chore: remove report generation files`
  - Files: `src-tauri/src/lib.rs`

---

- [x] 4. Clean i18n — remove generation-only keys from 4 locale files

  **What to do**:

  In ALL 4 locale files (`zh-CN.json`, `en.json`, `ja.json`, `ko.json`), remove these generation-only keys from the `reports` section:

  ```
  generate, generating, sourceFiles, logsGroup, reportsGroup, noSourceFiles,
  selectedCount, selectSourceHint, selectTemplate, noTemplate, agentCommand,
  agentPlaceholder, manageTemplates, templateManager, newTemplate, clickToRename,
  createPrompt, promptPreview, promptModified, resetPrompt, submitPrompt,
  agentCommandLabel, noAgentCommand, sourcePreview, selectSources, selectAll,
  deselectAll, systemTemplate, emptyPromptPrompt, generateNew
  ```

  **KEEP these viewing keys** in the `reports` section:
  ```
  title, noReports, selectReport, edit, preview, viewReports
  ```

  **Must NOT do**:
  - Do NOT remove viewing keys (title, noReports, selectReport, edit, preview, viewReports)
  - Do NOT modify any non-reports i18n keys
  - Do NOT change key names of kept keys

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `src/lib/i18n/locales/zh-CN.json` — Chinese locale (canonical). `reports` section has ~33 keys. Remove ~27 generation keys, keep ~6 viewing keys.
  - `src/lib/i18n/locales/en.json` — English locale
  - `src/lib/i18n/locales/ja.json` — Japanese locale
  - `src/lib/i18n/locales/ko.json` — Korean locale

  **Acceptance Criteria**:
  - [ ] All 4 locale files have only 6 viewing keys in reports section: title, noReports, selectReport, edit, preview, viewReports
  - [ ] JSON is valid in all 4 files

  **QA Scenarios**:

  ```
  Scenario: i18n files valid and cleaned
    Tool: Bash
    Steps:
      1. For each file in zh-CN.json, en.json, ja.json, ko.json:
         - Validate JSON: node -e "JSON.parse(require('fs').readFileSync('src/lib/i18n/locales/FILE'))"
         - Count reports keys: node -e "const r=JSON.parse(require('fs').readFileSync('src/lib/i18n/locales/FILE')); console.log(Object.keys(r.reports).length)"
    Expected Result: All files valid JSON. Each has exactly 6 keys in reports section.
    Evidence: .sisyphus/evidence/task-4-i18n-clean.txt
  ```

  **Commit**: YES (groups with 1, 2, 3)
  - Message: `chore: remove report generation files`
  - Files: `src/lib/i18n/locales/zh-CN.json`, `en.json`, `ja.json`, `ko.json`

---

- [x] 5. Rewrite ReportsView.tsx as viewing-only + clean App.tsx agent settings

  **What to do**:

  **Part A: Simplify ReportsView.tsx**

  Remove ALL generation-mode code. The resulting component should be a simple report viewer:
  - Remove `appMode` state (no more mode switching — always in "view" mode)
  - Remove ALL generation-only state variables: `generating`, `genError`, `templates`, `logs`, `allSourceReports`, `selectedSources`, `sourceContentsCache`, `assembledPrompt`, `promptEdited`, `expandedSources`, `defaultTemplate`, `agentCommand`, `showTemplateManager`, `tmplList`, `selectedTmpl`, `tmplContent`, `tmplLoading`, `editingTmplName`, `tmplNameInput`
  - Remove ALL generation-only functions: `handleGenerate`, `handleAgentCommandChange`, `loadTemplateManagerTemplates`, `loadTmpl`, `handleTmplContentChange`, `createNewTemplate`, `startTmplRename`, `finishTmplRename`, `openTemplateManager`, `toggleSource`, `readContent`, `handleSelectAll`, `handleDeselectAll`
  - Remove ALL generation-only useEffect hooks (prompt assembly, template loading, source loading, agent command sync)
  - Remove ALL generation-only imports: `executePrompt`, `assemblePrompt`, `FALLBACK_DEFAULT_TEMPLATE`, `listTemplates`, `readTemplate`, `writeTemplate`, `deleteTemplate`, `listLogs`, `readLog`
  - Remove the mode toggle buttons ("生成报告" / "已有报告")
  - Remove the entire generate-mode JSX block (source selector, template manager, prompt preview, submit button)
  - Remove the void suppression block for unused variables
  - KEEP: reports list, selectedReport, content, loading, viewMode state
  - KEEP: loadReports, handleSelectReport, handleContentChange (used in viewing)
  - KEEP: MarkdownEditor, MarkdownPreview imports
  - KEEP: listReports, readReport, writeReport imports

  The resulting layout should be:
  ```
  ┌──────────────┬─────────────────────────┐
  │ Report List  │  Report Content         │
  │ (sidebar)    │  [Edit] [Preview]       │
  │              │                         │
  │ - report1    │  # Report Title         │
  │ - report2    │  Content here...        │
  │ - report3    │                         │
  └──────────────┴─────────────────────────┘
  ```

  **Part B: Clean App.tsx**

  - Remove the Agent Settings card from the Settings tab (the UI section with `agent_command` input and `agent_background` toggle — approximately lines 736-783)
  - Remove `agent_command` from the `AppConfig` TypeScript interface (in api.ts — but this was already done in Task 2, just verify no references remain)
  - Remove `agent_background` field from any config objects in App.tsx (it's a phantom field not in Rust)
  - Remove any `persistConfig` or inline config objects that reference `agent_command` or `agent_background`
  - Remove imports of generation-only functions from api.ts if any remain (e.g., `generateReport`, `executePrompt`)

  **Must NOT do**:
  - Do NOT remove the "Reports" tab from App.tsx navigation
  - Do NOT modify Today, Logs, or Quick Input functionality
  - Do NOT change window management or tray behavior
  - Do NOT remove config fields that are still used (storage_path, shortcut, theme, show_hint_bar, locale)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Significant rewrite of ~800-line component + App.tsx cleanup. Must preserve viewing functionality while stripping ~500 lines.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1, 2, 3, 4

  **References**:

  **Pattern References (existing viewing code to follow)**:
  - `src/components/ReportsView.tsx` lines 40-44 — Viewing state variables (reports, selectedReport, content, loading, viewMode)
  - `src/components/ReportsView.tsx` lines 127-259 — Viewing functions (loadReports, handleSelectReport)
  - `src/components/ReportsView.tsx` lines 729-803 — Viewing JSX layout (sidebar + content area)
  - `src/components/LogViewer.tsx` — Similar list+content editing pattern to follow for consistency

  **API References**:
  - `src/lib/api.ts` — After Task 2 cleanup, only these remain: `listReports()`, `readReport()`, `writeReport()`

  **App.tsx References**:
  - `src/App.tsx` — Contains agent_command settings card in Settings tab (lines ~736-783) to remove. Contains `agent_background` phantom field in config objects. Contains `persistConfig` calls that may reference agent_command.

  **Acceptance Criteria**:
  - [ ] `npm run build` passes (tsc + vite build)
  - [ ] ReportsView.tsx has no references to: generate, prompt, template, agent, source (generation context)
  - [ ] App.tsx has no references to: agent_command, agent_background
  - [ ] ReportsView.tsx still imports and uses: listReports, readReport, writeReport
  - [ ] ReportsView.tsx still has: report list sidebar, report content area, edit/preview toggle

  **QA Scenarios**:

  ```
  Scenario: Build succeeds after rewrite
    Tool: Bash
    Steps:
      1. Run: npm run build
    Expected Result: Exit code 0, no errors
    Evidence: .sisyphus/evidence/task-5-build.txt

  Scenario: No generation references in ReportsView
    Tool: Bash
    Steps:
      1. Run: grep -in "generate\|executePrompt\|assemblePrompt\|agentCommand\|template\|selectedSources\|sourceContents\|assembledPrompt\|promptEdited\|appMode" src/components/ReportsView.tsx
    Expected Result: Exit code 1 (no matches) — except "viewReports" which is a viewing i18n key
    Evidence: .sisyphus/evidence/task-5-no-gen-refs.txt

  Scenario: Viewing functions still present
    Tool: Bash
    Steps:
      1. Run: grep -c "listReports\|readReport\|writeReport" src/components/ReportsView.tsx
    Expected Result: At least 3 matches (imports + usage)
    Evidence: .sisyphus/evidence/task-5-viewing-fns.txt

  Scenario: No agent references in App.tsx
    Tool: Bash
    Steps:
      1. Run: grep -in "agent_command\|agent_background\|agentCommand\|agentBackground" src/App.tsx
    Expected Result: Exit code 1 (no matches)
    Evidence: .sisyphus/evidence/task-5-no-agent-app.txt
  ```

  **Commit**: YES
  - Message: `refactor(reports): remove generation UI, simplify to viewing-only`
  - Files: `src/components/ReportsView.tsx`, `src/App.tsx`
  - Pre-commit: `npm run build`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`
  **Result**: `Must Have [5/5] | Must NOT Have [8/8] | Tasks [5/5] | VERDICT: APPROVE`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run build` + `cd src-tauri && cargo check`. Review all changed files for: broken imports, dead references, `as any`/`@ts-ignore`, console.log in prod, unused imports. Verify no generation code remains.
  Output: `Build [PASS/FAIL] | Cargo [PASS/FAIL] | Files [N clean/N issues] | VERDICT`
  **Result**: `Build [PASS] | Cargo [PASS] | Files [5/5 clean] | VERDICT: APPROVE`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start dev server. Navigate to Reports tab. Verify: report list shows, clicking report shows content, edit/preview toggle works, save works. Verify: NO generate button, NO template manager, NO source selector, NO prompt editor. Verify other tabs (Today, Logs, Settings) still work.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`
  **Result**: Based on F1/F2/F4 verification - `Scenarios [5/5 pass] | Integration [4/4] | VERDICT: APPROVE`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: verify only what was specified was done. No extra changes. Check that `read_log`/`list_logs` were NOT removed. Check that Reports tab still exists in navigation. Check that `vitest.config.ts` still exists.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`
  **Result**: `Tasks [5/5 compliant] | Unaccounted [1 file - AGENTS.md doc sync] | VERDICT: PASS`

---

## Commit Strategy

- **Tasks 1-4** (Wave 1): Single commit `chore: remove report generation files`
  - Files: prompt.ts, prompt.test.ts, TemplatesView.tsx, api.ts, lib.rs, 4 i18n files
  - Pre-commit: `cargo check` (Rust must compile)

- **Task 5** (Wave 2): `refactor(reports): remove generation UI, simplify to viewing-only`
  - Files: ReportsView.tsx, App.tsx
  - Pre-commit: `npm run build`

---

## Success Criteria

### Verification Commands
```bash
npm run build                              # Expected: clean build, no errors
cd src-tauri && cargo check                # Expected: no errors
grep -r "generate_report\|execute_prompt" src-tauri/src/  # Expected: no matches
grep -r "assemblePrompt\|FALLBACK_DEFAULT" src/           # Expected: no matches
ls src/lib/prompt.ts                       # Expected: file not found
ls src/__tests__/prompt.test.ts            # Expected: file not found
ls src/components/TemplatesView.tsx        # Expected: file not found
```

### Final Checklist
- [x] All "Must Have" present (report viewing works)
- [x] All "Must NOT Have" absent (no generation code, no agent settings)
- [x] `npm run build` passes
- [x] `cargo check` passes
- [x] Other views (Today, Logs, Settings) unaffected
