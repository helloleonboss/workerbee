# 快捷截图功能

## TL;DR

> **Quick Summary**: 为 WorkerBee 添加快捷截图功能。全局快捷键触发 → xcap 截取全屏 → 自定义透明 overlay 窗口做区域选择 → WebP 保存 → 自动插入 markdown 图片引用到当天 log。支持缩略图预览、点击放大、AI 多模态理解截图内容。
>
> **Deliverables**:
> - Rust 截图命令（xcap 捕获 + 区域裁剪 + WebP 编码）
> - 透明选区 overlay 窗口（类似 Snipaste 的拖拽选区体验）
> - 全局快捷键配置（复用现有 Settings 的 ShortcutRecorder）
> - 截图自动保存 + markdown `![](path)` 引用插入
> - MarkdownPreview 图片点击放大查看
> - AI 报告生成支持多模态图片输入
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: T1 → T4 → T9 → F1-F4

---

## Context

### Original Request
用户希望支持快捷截图来记录工作内容。全局快捷键 → 自由选区截图 → 静默保存为 log 条目 → markdown 图片引用。Today/LogViewer 中查看缩略图和放大 → AI 多模态理解截图内容。

### Interview Summary
**Key Discussions**:
- 触发方式: 全局快捷键，复用现有 Settings 配置机制
- 截图范围: 自由选区（Snipaste 风格拖拽）
- 截图后: 静默保存，不打断用户
- 存储: 统一 `~/.workerbee/screenshots/` 目录，WebP 格式
- Log 集成: Markdown `![](../screenshots/xxx.webp)` 直接嵌入
- 查看: 缩略图 + 点击放大 + AI 多模态看图
- 标注: 非必须，Phase 2 可选

**Research Findings**:
- `xcap`（954 stars，630K+ downloads）: 最成熟的跨平台截图 Rust crate
- `screen-snip`（2 stars，用 EGUI）: 会开独立窗口，风格不搭 → 拒绝
- `ferrishot`（223 stars，用 Iced）: 独立应用，不好嵌入 → 拒绝
- `tauri-plugin-screenshots`: 没有选区 UI → 拒绝
- 自定义透明 overlay: Tauri 标准模式，screenpipe (17K stars)、Pluely 等项目使用

### Metis Review
**Identified Gaps** (addressed):
- 多显示器: 首版仅支持主显示器，后续增强
- 取消操作: Escape 键取消选区
- 删除 log 条目时是否删除图片文件: 首版不同步删除，手动管理
- MarkdownPreview 图片渲染: 已有 `img { max-width: 100% }` 样式，需添加点击放大
- AI 多模态: 需要将图片 base64 编码后以 OpenAI vision 格式发送

---

## Work Objectives

### Core Objective
为 WorkerBee 添加完整的快捷截图功能，让用户通过全局快捷键截取屏幕区域并自动记录到工作日志中，截图可在 AI 报告生成时被多模态 AI 理解。

### Concrete Deliverables
- `screenshot-overlay.html` + `src/screenshot-overlay/` — 新 Vite 入口和选区组件
- Rust 新命令: `capture_screens`, `save_screenshot`, `show_screenshot_overlay`
- `AppConfig` 新增 `screenshot_shortcut` 字段
- Settings UI 新增截图快捷键配置
- MarkdownPreview 图片点击放大
- AI 报告生成支持图片

### Definition of Done
- [ ] 按截图快捷键 → 出现透明选区 overlay → 拖拽选区 → 截图保存到 screenshots/ → 当天 log 自动插入图片引用
- [ ] Today 视图和 LogViewer 中截图以缩略图形式展示
- [ ] 点击缩略图可放大查看
- [ ] Settings 中可配置截图快捷键
- [ ] AI 生成报告时能引用截图内容

### Must Have
- xcap 全屏捕获 + 区域裁剪
- 透明 overlay 选区窗口（拖拽选择、Escape 取消）
- WebP 编码保存到 `~/.workerbee/screenshots/`
- 自动在当天 log 插入 `## HH:mm\n\n![](../screenshots/xxx.webp)`
- Settings 中可配置截图快捷键
- MarkdownPreview 图片点击放大
- AI 多模态支持（OpenAI vision 格式）

### Must NOT Have (Guardrails)
- 不添加标注/画笔工具（Phase 2）
- 不添加 OCR 文字提取
- 不添加截图历史管理界面
- 不使用 EGUI/Iced 等外部 GUI 框架创建选区窗口
- 不修改现有 QuickInput 窗口的行为
- 不修改现有文字 log 条目的格式
- 不在 overlay 中显示 WorkerBee 自己的窗口
- 不使用 `as any`、`@ts-ignore`、`@ts-expect-error`
- 不硬编码 UI 字符串 — 使用 `t()`
- 不声明 overlay 窗口在 `tauri.conf.json` — 动态创建（同 quick-input）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO（项目无测试框架）
- **Automated tests**: None
- **Framework**: none
- **QA**: Agent-executed QA scenarios only

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Rust commands**: Use Bash (cargo check/test) — 验证编译通过
- **Frontend components**: Use Playwright — 验证 UI 渲染和交互
- **Integration**: Use tauri-agent-control — 验证完整截图流程
- **AI integration**: Use Bash (curl) — 验证 API 请求格式

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - foundation):
├── T1: Cargo 依赖 + Rust 类型扩展 [quick]
├── T2: i18n 截图相关字符串 [quick]
└── T3: Screenshot overlay Vite 入口 [quick]

Wave 2 (After Wave 1 - core implementation):
├── T4: Rust 截图捕获+保存命令 [deep]
├── T5: Overlay 选区 React 组件 [unspecified-high]
├── T6: Settings 截图快捷键 UI [quick]
└── T7: MarkdownPreview 图片增强 [visual-engineering]

Wave 3 (After Wave 2 - integration):
├── T8: AI 多模态集成 [unspecified-high]
├── T9: 截图编排 + 全局快捷键 [deep]
└── T10: Today + LogViewer 截图渲染验证 [unspecified-high]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA (unspecified-high)
└── F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: T1 → T4 → T9 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 4 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| T1 | - | T4, T6, T8 | 1 |
| T2 | - | T6 | 1 |
| T3 | - | T5 | 1 |
| T4 | T1 | T8, T9 | 2 |
| T5 | T3 | T9 | 2 |
| T6 | T1, T2 | T9 | 2 |
| T7 | - | T10 | 2 |
| T8 | T4 | FINAL | 3 |
| T9 | T4, T5, T6 | FINAL | 3 |
| T10 | T7 | FINAL | 3 |

### Agent Dispatch Summary

- **Wave 1**: **3** — T1 → `quick`, T2 → `quick`, T3 → `quick`
- **Wave 2**: **4** — T4 → `deep`, T5 → `unspecified-high`, T6 → `quick`, T7 → `visual-engineering`
- **Wave 3**: **3** — T8 → `unspecified-high`, T9 → `deep`, T10 → `unspecified-high`
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Cargo 依赖 + Rust AppConfig 类型扩展

  **What to do**:
  - 在 `Cargo.toml` 添加依赖: `xcap = "0.4"`, `image = { version = "0.25", features = ["webp", "png"] }`, `base64 = "0.22"`
  - 在 Rust `AppConfig` 结构体中添加 `screenshot_shortcut` 字段，默认值 `"CommandOrControl+Shift+S"`
  - 添加 `default_screenshot_shortcut()` 函数（同 `default_shortcut` 模式）
  - 在 TypeScript `src/lib/api.ts` 的 `AppConfig` 接口中添加 `screenshot_shortcut?: string`
  - 在 `ensure_dirs` 函数中添加创建 `screenshots/` 目录的逻辑（同 `logs/` 和 `reports/` 模式）
  - 添加 `ScreenshotShortcutState(Mutex<String>)` managed state（同 `ShortcutState` 模式）

  **Must NOT do**:
  - 不修改现有 `shortcut` 字段的行为
  - 不删除或改变现有的 `ensure_dirs` 逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯类型/依赖添加，模式清晰，无需复杂推理
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2, T3)
  - **Blocks**: T4, T6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src-tauri/src/lib.rs:38-67` — AppConfig 结构体定义 + serde(default) 模式，新字段必须遵循同样模式
  - `src-tauri/src/lib.rs:11-13` — `default_shortcut()` 函数模式，新 `default_screenshot_shortcut()` 复制此模式
  - `src-tauri/src/lib.rs:521` — `ShortcutState(Mutex::new(default_shortcut()))` 模式，需要添加第二个 `ScreenshotShortcutState`
  - `src-tauri/src/lib.rs:218` — `ensure_dirs` 函数调用位置，截图目录创建需加入此处

  **API/Type References**:
  - `src/lib/api.ts:115-124` — TypeScript AppConfig 接口，需同步添加 `screenshot_shortcut` 字段

  **External References**:
  - xcap crate: https://crates.io/crates/xcap — 跨平台截图库
  - image crate: https://crates.io/crates/image — 图片处理，需启用 webp feature

  **WHY Each Reference Matters**:
  - AppConfig 结构体的 serde(default) 模式确保向后兼容（旧配置文件没有新字段也能正常加载）
  - ensure_dirs 在 save_config 时调用，添加 screenshots/ 确保目录存在
  - TypeScript 类型必须与 Rust 结构体保持同步

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Rust 编译通过
    Tool: Bash
    Preconditions: Cargo.toml 已更新，lib.rs 已修改
    Steps:
      1. Run `cargo check` in src-tauri/ directory
      2. Verify exit code is 0
    Expected Result: No compilation errors
    Failure Indicators: cargo check returns non-zero exit code
    Evidence: .sisyphus/evidence/task-1-cargo-check.txt

  Scenario: TypeScript 类型编译通过
    Tool: Bash
    Preconditions: api.ts 已更新
    Steps:
      1. Run `npx tsc --noEmit`
      2. Verify exit code is 0
    Expected Result: No type errors
    Failure Indicators: tsc returns errors related to AppConfig
    Evidence: .sisyphus/evidence/task-1-tsc-check.txt
  ```

  **Commit**: YES (groups with T2, T3)
  - Message: `feat(screenshot): add dependencies and type definitions`
  - Files: `src-tauri/Cargo.toml, src-tauri/src/lib.rs, src/lib/api.ts`
  - Pre-commit: `cargo check && npx tsc --noEmit`

- [x] 2. i18n 截图相关字符串

  **What to do**:
  - 在 4 个 locale 文件中添加截图相关的 i18n 字符串
  - 添加的 key 包括:
    - `settings.shortcut.screenshot`: 截图快捷键标题
    - `settings.shortcut.screenshotHint`: 截图快捷键说明
    - `settings.shortcut.screenshotDefault`: 默认截图快捷键
    - `screenshot.overlayHint`: 选区提示（如 "拖拽选择截图区域 · ESC 取消"）
    - `screenshot.saving`: 截图保存中
    - `screenshot.cancelled`: 截图已取消
  - 4 个 locale 文件: `zh-CN.json`, `en.json`, `ja.json`, `ko.json`
  - 遵循现有 JSON 结构，添加在正确的 section 下

  **Must NOT do**:
  - 不修改现有的 i18n key
  - 不删除任何现有字符串

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯 JSON 文件编辑，模式清晰
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T3)
  - **Blocks**: T6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/lib/i18n/locales/zh-CN.json:86-93` — `settings.shortcut` section 结构，新 screenshot keys 添加在此 section 下
  - `src/lib/i18n/locales/zh-CN.json:135-140` — `quickInput` section 结构，`screenshot` section 参照此结构添加
  - `src/lib/i18n/locales/en.json` — 对应英文翻译，查看现有翻译风格

  **WHY Each Reference Matters**:
  - 必须遵循现有的 JSON 嵌套结构，确保 `t()` 函数能正确解析路径
  - 4 个 locale 文件必须包含完全相同的 key 结构

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 4 个 locale 文件包含所有新增 key
    Tool: Bash
    Preconditions: 所有 4 个 locale 文件已更新
    Steps:
      1. For each locale file (zh-CN, en, ja, ko), grep for "screenshot" key
      2. Verify all 6 new keys exist in each file
      3. Verify JSON is valid: `node -e "JSON.parse(require('fs').readFileSync('path'))"`
    Expected Result: All 6 screenshot-related keys present in all 4 files, valid JSON
    Failure Indicators: Missing keys or invalid JSON syntax
    Evidence: .sisyphus/evidence/task-2-i18n-check.txt
  ```

  **Commit**: YES (groups with T1, T3)
  - Message: `feat(screenshot): add i18n strings for screenshot feature`
  - Files: `src/lib/i18n/locales/*.json`

- [x] 3. Screenshot overlay Vite 入口

  **What to do**:
  - 创建 `screenshot-overlay.html`（参照 `quick-input.html` 模式）
  - HTML 中 body background: transparent，引入新的入口脚本
  - 在 `vite.config.ts` 的 `rollupOptions.input` 中添加第三个入口 `screenshot-overlay`
  - 创建 `src/screenshot-overlay/main.tsx` 入口文件（最小骨架，后续 T5 填充选区组件）
  - main.tsx 需要: import React/ReactDOM, 渲染一个占位 `<div>`，后续会被 SelectionOverlay 替换
  - 创建 `src/screenshot-overlay/` 目录结构

  **Must NOT do**:
  - 不修改 `quick-input.html` 或 `src/quick-input/` 的任何文件
  - 不在 `tauri.conf.json` 中声明 overlay 窗口（动态创建）
  - 不从 `src/lib/` 导入任何工具函数（overlay 是独立入口，同 QuickInputApp）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 文件创建 + 配置修改，模式完全复制 quick-input
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2)
  - **Blocks**: T5
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `quick-input.html` — 完整的 HTML 入口模板，screenshot-overlay.html 照此模式创建
  - `src/quick-input/main.tsx` — React 入口文件模式，screenshot-overlay/main.tsx 参照此模式
  - `vite.config.ts:20-25` — `rollupOptions.input` 配置，添加第三个入口 `screenshot-overlay`

  **WHY Each Reference Matters**:
  - quick-input 是经过验证的双入口模式，overlay 必须完全遵循同样模式
  - Vite 配置必须包含所有入口才能正确构建
  - 独立入口意味着不能共享 src/lib/ 的工具函数（同 QuickInputApp 的限制）

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Vite 构建包含三个入口
    Tool: Bash
    Preconditions: screenshot-overlay.html 和 vite.config.ts 已更新
    Steps:
      1. Run `npx vite build` (or npm run build)
      2. Check dist/ directory contains screenshot-overlay.html
    Expected Result: Build succeeds, dist/screenshot-overlay.html exists
    Failure Indicators: Build fails or screenshot-overlay.html missing from dist
    Evidence: .sisyphus/evidence/task-3-vite-build.txt

  Scenario: TypeScript 编译通过
    Tool: Bash
    Steps:
      1. Run `npx tsc --noEmit`
    Expected Result: No type errors in new screenshot-overlay files
    Evidence: .sisyphus/evidence/task-3-tsc-check.txt
  ```

  **Commit**: YES (groups with T1, T2)
  - Message: `feat(screenshot): add screenshot overlay Vite entry point`
  - Files: `screenshot-overlay.html, vite.config.ts, src/screenshot-overlay/main.tsx`

- [x] 4. Rust 截图捕获 + 保存命令

  **What to do**:
  - 添加 `CaptureState(Mutex<Option<CapturedScreen>>)` managed state 存储临时截图数据
  - `CapturedScreen` 结构体: 包含 `RgbaImage`（image crate）+ 显示器坐标信息
  - 实现 `capture_screens` command:
    1. 用 `xcap::Monitor::all()` 获取所有显示器
    2. 取主显示器（index 0）截取全屏 → `monitor.capture_image()` 返回 `RgbaImage`
    3. 将截图存入 `CaptureState`
    4. 将截图编码为 PNG base64 → 返回给前端 overlay 显示
    5. 返回显示器尺寸信息供 overlay 定位
  - 实现 `crop_and_save_screenshot` command:
    1. 从 `CaptureState` 取出之前截取的图片
    2. 根据前端传来的选区坐标 (x, y, width, height) 裁剪 `image::crop()`
    3. 编码为 WebP 格式: `image::codecs::webp::WebPEncoder`
    4. 生成文件名: `YYYY-MM-DD_HH-mm-ss.webp`（使用 chrono）
    5. 保存到 `{storage_path}/screenshots/{filename}`
    6. 返回相对路径 `../screenshots/{filename}` 供 markdown 引用
  - 实现 `save_screenshot_log_entry` command:
    1. 获取当前时间和日期
    2. 构造 log 条目: `## HH:mm\n\n![]({relative_path})`
    3. 追加到当天 log 文件（复用现有的 log 文件追加模式）
  - 处理 HiDPI 缩放: overlay 窗口的 CSS 像素可能与物理像素不同，坐标需要缩放

  **Must NOT do**:
  - 不捕获 overlay 窗口本身（先截图，再创建 overlay）
  - 不使用 EGUI 或其他 GUI 框架
  - 不在内存中保存大量截图数据（裁剪后释放 CaptureState）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 涉及 xcap/image crate 的 Rust FFI 调用，HiDPI 缩放处理，需要深入理解
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T5, T6, T7)
  - **Blocks**: T8, T9
  - **Blocked By**: T1

  **References**:

  **Pattern References**:
  - `src-tauri/src/lib.rs:38-67` — AppConfig 结构体模式，CaptureState 遵循同样的 managed state 模式
  - `src-tauri/src/lib.rs:81-100` — `ensure_dirs()` 函数，确认 `screenshots/` 目录已被 T1 添加
  - `src-tauri/src/lib.rs:138-160` — `save_log()` 命令模式（追加到 markdown 文件），`save_screenshot_log_entry` 复用此模式
  - `src-tauri/src/lib.rs:521` — managed state 注册模式 `.manage(ShortcutState(...))`

  **API/Type References**:
  - `src/lib/api.ts:138-140` — `saveLog()` invoke 模式，新命令遵循同样的 TS wrapper 模式

  **External References**:
  - xcap crate docs: https://docs.rs/xcap — `Monitor::all()`, `capture_image()` API
  - image crate docs: https://docs.rs/image — `crop()`, `WebPEncoder`, `RgbaImage`

  **WHY Each Reference Matters**:
  - save_log 的文件追加模式是保存截图 log 条目的参考实现
  - managed state 模式确保截图数据在 capture 和 crop 之间安全传递
  - xcap 的 capture_image 返回 RgbaImage，可直接用 image crate 处理

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: capture_screens 命令返回有效数据
    Tool: Bash (cargo test or manual invoke)
    Preconditions: xcap 和 image crate 已添加，命令已实现
    Steps:
      1. Run `cargo check` in src-tauri/
      2. Verify capture_screens command signature and return type
    Expected Result: Compiles, command returns base64 PNG string + monitor dimensions
    Failure Indicators: Compilation error or missing command registration
    Evidence: .sisyphus/evidence/task-4-cargo-check.txt

  Scenario: crop_and_save_screenshot 正确处理坐标
    Tool: Bash
    Steps:
      1. Verify crop logic handles: normal selection, edge selection (0,0 origin)
      2. Verify WebP encoding produces valid file
      3. Verify file is saved to correct screenshots/ directory
    Expected Result: WebP file created in screenshots/ dir, valid image format
    Failure Indicators: File not created or corrupted
    Evidence: .sisyphus/evidence/task-4-save-test.txt

  Scenario: 选区超出屏幕边界处理
    Tool: Bash (cargo check)
    Steps:
      1. Verify crop coordinates are clamped to image dimensions
      2. Verify minimum selection size check (e.g., 5x5 pixels)
    Expected Result: Graceful handling of out-of-bounds or tiny selections
    Evidence: .sisyphus/evidence/task-4-edge-cases.txt
  ```

  **Commit**: YES (groups with T5, T6, T7)
  - Message: `feat(screenshot): implement capture, crop, and save commands in Rust`
  - Files: `src-tauri/src/lib.rs, src/lib/api.ts`
  - Pre-commit: `cargo check`

- [x] 5. Overlay 选区 React 组件

  **What to do**:
  - 在 `src/screenshot-overlay/main.tsx` 中实现完整的选区 overlay 应用
  - 组件流程:
    1. 监听 Tauri 事件 `screenshot-overlay-ready`，接收截图 base64 数据和显示器信息
    2. 将截图显示为全屏背景图
    3. 覆盖半透明黑色遮罩（opacity 0.3-0.5）
    4. 用户按下鼠标左键开始拖拽 → 记录起始坐标
    5. 拖拽过程中实时显示选区矩形（白色/蓝色边框，内部透明显示原图）
    6. 显示选区尺寸信息（如 "320 × 240"）
    7. 松开鼠标 → 发送选区坐标到 Rust（通过 invoke `crop_and_save_screenshot`）
    8. ESC 键取消 → 通知 Rust 关闭 overlay
    9. 右键取消 → 同 ESC
  - CSS 实现:
    - 背景: `background-image: url(data:image/png;base64,...)` 全屏覆盖
    - 遮罩: `background: rgba(0,0,0,0.4)` 覆盖全屏
    - 选区: 使用 `clip-path` 或绝对定位 div 实现选区透明效果
    - 选区边框: 2px 蓝色/白色虚线
    - 十字光标: `cursor: crosshair`
  - 由于是独立 Vite 入口，不能导入 `src/lib/` 的工具函数（同 QuickInputApp 限制）
  - 自行处理 Tauri invoke 和事件监听

  **Must NOT do**:
  - 不导入 `src/lib/` 下的任何模块（独立入口限制）
  - 不使用 `src/lib/i18n/` 的 t() 函数（自行内联或跳过国际化，overlay 文字极少）
  - 不添加复杂的标注工具（Phase 2）
  - 不添加窗口装饰/标题栏

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 涉及复杂的鼠标事件处理、CSS clip-path、全屏 overlay 逻辑，需要一定推理能力
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T4, T6, T7)
  - **Blocks**: T9
  - **Blocked By**: T3

  **References**:

  **Pattern References**:
  - `src/quick-input/main.tsx` — 独立 Vite 入口的模式：自己 import React/ReactDOM，自己处理 Tauri 事件，不能导入 src/lib/
  - `quick-input.html` — HTML 结构模式：transparent background，单 `<div id="root">`

  **API/Type References**:
  - `src/lib/api.ts` — invoke wrapper 模式，overlay 需要直接使用 `invoke()` from `@tauri-apps/api/core`

  **External References**:
  - CSS clip-path overlay technique: https://developer.mozilla.org/en-US/docs/Web/CSS/clip-path
  - Tauri event system: https://v2.tauri.app/develop/calling-rust/#events

  **WHY Each Reference Matters**:
  - QuickInput 是唯一验证过的独立入口参考，必须遵循完全相同的模式
  - clip-path 是实现"选区透明、周围变暗"效果最高效的 CSS 方案
  - 不能使用 src/lib/ 的限制意味着所有 Tauri API 调用必须内联

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Overlay 组件正确渲染截图背景
    Tool: Playwright
    Preconditions: screenshot-overlay.html 可访问
    Steps:
      1. Navigate to screenshot-overlay.html in browser
      2. Emit "screenshot-overlay-ready" event with test base64 image data
      3. Verify background image is set on overlay div
      4. Verify dark mask covers the screen
    Expected Result: Full-screen background with dark overlay visible
    Failure Indicators: No background image, no dark overlay
    Evidence: .sisyphus/evidence/task-5-overlay-render.png

  Scenario: 拖拽选区显示正确
    Tool: Playwright
    Steps:
      1. Simulate mousedown at (100, 100)
      2. Simulate mousemove to (400, 300)
      3. Verify selection rectangle visible with correct position and size
      4. Verify dimension text shows "300 × 200"
    Expected Result: Selection rectangle displayed with correct coordinates
    Evidence: .sisyphus/evidence/task-5-selection-drag.png

  Scenario: ESC 取消选区
    Tool: Playwright
    Steps:
      1. Render overlay
      2. Press Escape key
      3. Verify invoke("cancel_screenshot") was called
    Expected Result: Cancel command invoked, overlay ready to close
    Evidence: .sisyphus/evidence/task-5-esc-cancel.txt
  ```

  **Commit**: YES (groups with T4, T6, T7)
  - Message: `feat(screenshot): implement screenshot overlay selection component`
  - Files: `src/screenshot-overlay/main.tsx`

- [x] 6. Settings 截图快捷键 UI

  **What to do**:
  - 在 Settings 视图的快捷键 section 中添加截图快捷键配置
  - 复用现有 `ShortcutRecorder` 组件记录快捷键
  - 显示: "截图" 标签 + ShortcutRecorder + 说明文字
  - 保存时更新 `AppConfig.screenshot_shortcut` 字段
  - 位置: 在现有"快速记录"快捷键配置下方

  **Must NOT do**:
  - 不修改现有"快速记录"快捷键的行为
  - 不创建新的 ShortcutRecorder 组件（复用现有的）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 复用现有 ShortcutRecorder 组件，添加一个配置项
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T4, T5, T7)
  - **Blocks**: T9
  - **Blocked By**: T1, T2

  **References**:

  **Pattern References**:
  - `src/App.tsx` — Settings 视图中的快捷键 section，新截图快捷键配置参照现有"快速记录"配置
  - `src/components/ShortcutRecorder.tsx` — 快捷键录制组件，直接复用

  **API/Type References**:
  - `src/lib/api.ts:115-124` — AppConfig 接口，`screenshot_shortcut` 字段由 T1 添加
  - `src/lib/i18n/locales/zh-CN.json:86-93` — `settings.shortcut` section，T2 添加了 screenshot 相关 key

  **WHY Each Reference Matters**:
  - 现有快捷键配置是经过验证的 UI 模式，新配置必须视觉一致
  - ShortcutRecorder 组件已处理了所有键盘事件到 Tauri 快捷键字符串的转换

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Settings 页面显示截图快捷键配置
    Tool: Playwright
    Steps:
      1. Navigate to main window, switch to Settings tab
      2. Find shortcut section
      3. Verify "截图" label and ShortcutRecorder visible below "快速记录"
    Expected Result: Screenshot shortcut config UI visible with correct label
    Evidence: .sisyphus/evidence/task-6-settings-ui.png

  Scenario: 修改截图快捷键并保存
    Tool: Playwright
    Steps:
      1. Click "修改" button on screenshot shortcut
      2. Press Ctrl+Alt+S
      3. Verify shortcut displayed as "Ctrl+Alt+S"
      4. Save settings
      5. Reload and verify persisted
    Expected Result: Shortcut saved and persisted across reload
    Evidence: .sisyphus/evidence/task-6-shortcut-save.txt
  ```

  **Commit**: YES (groups with T4, T5, T7)
  - Message: `feat(screenshot): add screenshot shortcut configuration in settings`
  - Files: `src/App.tsx`

- [x] 7. MarkdownPreview 图片增强

  **What to do**:
  - 在 MarkdownPreview 组件中为 `<img>` 标签添加点击放大功能
  - 实现: 使用 react-markdown 的 `components` prop 自定义 `img` 渲染
  - 点击图片 → 打开一个全屏半透明遮罩 + 居中显示大图（lightbox 模式）
  - Lightbox 组件:
    - 全屏 `fixed inset-0` 遮罩，`bg-black/80`
    - 图片居中 `max-w-[90vw] max-h-[90vh] object-contain`
    - 点击遮罩或按 ESC 关闭
    - 使用 shadcn/ui 的 Dialog 或自定义 overlay
  - 图片需要支持本地文件路径（Tauri 的 asset 协议或 convertFileSrc）
  - 注意: MarkdownPreview 中的图片路径是相对路径 `../screenshots/xxx.webp`，需要转换为绝对路径
  - 在 Today 视图的编辑模式下，图片应以缩略图形式展示（max-width 限制）

  **Must NOT do**:
  - 不修改 MarkdownPreview 的其他渲染逻辑
  - 不添加图片编辑/标注功能
  - 不使用外部 lightbox 库（自行实现，保持轻量）

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI 组件开发，涉及样式、动画、响应式布局
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T4, T5, T6)
  - **Blocks**: T10
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/components/MarkdownPreview.tsx:11-48` — 当前 MarkdownPreview 实现，react-markdown + remarkGfm
  - `src/components/MarkdownPreview.tsx:39` — 现有 img 样式 `.md-preview img { max-width: 100%; border-radius: 0.375rem; }`

  **API/Type References**:
  - Tauri `convertFileSrc` 或 asset protocol: 用于将本地文件路径转为 webview 可访问的 URL
  - `https://v2.tauri.app/reference/javascript/api/namespacecore/convertfilesrc/` — `convertFileSrc` API

  **External References**:
  - react-markdown components customization: https://github.com/remarkjs/react-markdown#options

  **WHY Each Reference Matters**:
  - react-markdown 的 components prop 是自定义渲染元素的标准方式
  - convertFileSrc 是 Tauri v2 访问本地文件的正确方式，直接使用 file:// 协议会被安全策略阻止
  - 现有 img 样式已有基础，只需添加 cursor-pointer 和 click handler

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 图片缩略图正确渲染
    Tool: Playwright
    Steps:
      1. Render MarkdownPreview with content containing `![alt](../screenshots/test.webp)`
      2. Verify img element is rendered with max-width: 100%
      3. Verify cursor is pointer
    Expected Result: Image renders as thumbnail with clickable cursor
    Evidence: .sisyphus/evidence/task-7-thumbnail-render.png

  Scenario: 点击图片打开 lightbox
    Tool: Playwright
    Steps:
      1. Render MarkdownPreview with image content
      2. Click on the image
      3. Verify full-screen overlay appears with dark background
      4. Verify large image is centered and visible
      5. Press ESC or click overlay to close
    Expected Result: Lightbox opens with enlarged image, closes on ESC/click
    Evidence: .sisyphus/evidence/task-7-lightbox-open.png
  ```

  **Commit**: YES (groups with T4, T5, T6)
  - Message: `feat(screenshot): add image lightbox to MarkdownPreview`
  - Files: `src/components/MarkdownPreview.tsx`

- [x] 8. AI 多模态集成

  **What to do**:
  - 修改 `generateReport()` 函数，当 log 内容包含图片引用时，将图片以 OpenAI vision 格式发送给 AI
  - OpenAI vision 格式: `content` 字段从 `string` 变为数组:
    ```json
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "日志内容..." },
        { "type": "image_url", "image_url": { "url": "data:image/webp;base64,..." } }
      ]
    }
    ```
  - 实现步骤:
    1. 解析 log 文本，找到所有 `![...](path)` 模式的图片引用
    2. 将相对路径转换为绝对路径
    3. 读取图片文件，编码为 base64
    4. 构造 vision 格式的消息内容（混合文字和图片）
  - 新增 Rust 命令 `read_screenshot_as_base64(path)` → 返回 base64 编码的图片数据
  - 在 TypeScript 端调用此命令获取图片数据
  - 注意: 只在 AI provider 支持多模态时发送图片（所有主流 provider 的现代模型都支持）
  - 图片大小限制: 如果单张图片超过 5MB base64，跳过该图片（避免 API 限制）

  **Must NOT do**:
  - 不修改 AI 报告生成的核心流式解析逻辑
  - 不添加 OCR 作为 fallback
  - 不改变 ChatMessage 类型中 `content` 为 string 的基本用法（仅在发送到 API 时构造数组格式）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要理解 OpenAI vision API 格式、图片处理、Rust/TS IPC 协作
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T9, T10)
  - **Blocks**: FINAL
  - **Blocked By**: T4

  **References**:

  **Pattern References**:
  - `src/lib/ai/generate.ts:127-149` — 当前 tauriFetch 调用和消息构造，需要修改 messages 格式支持 vision
  - `src/lib/ai/generate.ts:12-15` — ChatMessage 类型定义，content 为 string

  **API/Type References**:
  - `src/lib/api.ts:9-14` — AiConfig 类型，用于判断 provider
  - Rust 需新增 `read_screenshot_as_base64` 命令

  **External References**:
  - OpenAI Vision API: https://platform.openai.com/docs/guides/vision — 多模态消息格式
  - GLM Vision API: https://open.bigmodel.cn/dev/api/normal-model/glm-4v — 智谱多模态格式（与 OpenAI 兼容）

  **WHY Each Reference Matters**:
  - 当前的 tauriFetch 调用发送 messages 数组，需要修改为支持 content 为数组格式
  - OpenAI 和智谱的多模态 API 格式一致，不需要区分 provider
  - 需要在 Rust 端读取图片文件并 base64 编码返回给 TS

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 带图片的 log 生成包含图片数据的 API 请求
    Tool: Bash (code review)
    Steps:
      1. Verify generateReport detects ![...](path) patterns in log content
      2. Verify it calls read_screenshot_as_base64 for each image
      3. Verify messages array contains image_url entries
      4. Verify text content is preserved alongside images
    Expected Result: API request contains both text and image data in vision format
    Evidence: .sisyphus/evidence/task-8-vision-format.txt

  Scenario: 无图片的 log 不影响现有行为
    Tool: Bash (code review)
    Steps:
      1. Verify generateReport with text-only log produces same message format as before
      2. No image_url entries added
    Expected Result: Text-only logs work exactly as before
    Evidence: .sisyphus/evidence/task-8-text-only.txt
  ```

  **Commit**: YES (groups with T9, T10)
  - Message: `feat(screenshot): integrate multimodal AI vision for screenshots in reports`
  - Files: `src/lib/ai/generate.ts, src-tauri/src/lib.rs, src/lib/api.ts`

- [x] 9. 截图编排 + 全局快捷键

  **What to do**:
  - 这是整个截图功能的编排任务，将 T4/T5/T6 的各个模块串联起来
  - **全局快捷键注册**:
    1. 在 `setup()` 中注册第二个全局快捷键（截图快捷键），使用 `ScreenshotShortcutState`
    2. 快捷键处理函数: 调用 `capture_screens` → 创建 overlay 窗口 → 发送截图数据
    3. 在 `save_config_cmd` 中添加截图快捷键变更时的重新注册逻辑（同现有 shortcut 模式）
  - **Overlay 窗口生命周期**:
    1. 快捷键触发时:
       - 先调用 `capture_screens` 截取全屏
       - 创建透明 overlay 窗口（`WebviewWindowBuilder`: transparent, always_on_top, decorations=false, skip_taskbar, fullscreen/覆盖主显示器）
       - 通过 `emit("screenshot-overlay-ready", { image_base64, monitor_width, monitor_height })` 发送截图数据
    2. Overlay 选区完成时:
       - 前端调用 `crop_and_save_screenshot` 命令
       - Rust 裁剪并保存图片
       - 调用 `save_screenshot_log_entry` 插入 log 条目
       - 关闭 overlay 窗口
       - 发送 `focusChanged` 事件刷新主窗口
    3. 取消时:
       - 前端调用 `cancel_screenshot` 命令
       - Rust 关闭 overlay 窗口，清理 CaptureState
  - **overlay 窗口 URL**: 
    - dev 模式: `http://localhost:1420/screenshot-overlay.html`
    - prod 模式: `tauri::WebviewUrl::App("screenshot-overlay.html".into())`
    - 参照 quick-input 的 URL 判断模式
  - **HiDPI 处理**: overlay 窗口坐标需要考虑系统缩放比例
  - **注册所有新命令**到 `invoke_handler(tauri::generate_handler![...])`

  **Must NOT do**:
  - 不修改现有 QuickInput 的快捷键注册逻辑
  - 不在 overlay 中捕获 WorkerBee 自身窗口（可以先 hide 主窗口再截图，或接受此限制）
  - 不使用 EGUI/Iced 等外部 GUI 框架

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 复杂的编排逻辑，涉及窗口生命周期、HiDPI、快捷键注册，需要深入理解
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T8, T10)
  - **Blocks**: FINAL
  - **Blocked By**: T4, T5, T6

  **References**:

  **Pattern References**:
  - `src-tauri/src/lib.rs:505-570` — `setup()` 函数中全局快捷键注册 + QuickInput 窗口创建，截图快捷键和 overlay 窗口必须遵循完全相同模式
  - `src-tauri/src/lib.rs:221-241` — `save_config_cmd` 中的快捷键变更处理，截图快捷键需添加同样逻辑
  - `src-tauri/src/lib.rs:553-569` — QuickInput 窗口创建（dev/prod URL 判断 + 窗口属性），overlay 窗口参照此模式

  **API/Type References**:
  - `src/lib/api.ts:138-140` — `saveLog()` 模式，新命令的 TS wrapper 遵循同样模式

  **WHY Each Reference Matters**:
  - 现有快捷键注册是在 setup() 中一次性完成的，新增截图快捷键必须在同一位置注册
  - overlay 窗口的创建模式必须与 quick-input 完全一致（dev/prod URL、window attributes）
  - save_config_cmd 中的快捷键变更检测需要扩展为同时处理两个快捷键

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 完整截图流程端到端
    Tool: tauri-agent-control skill
    Preconditions: 应用正在运行，截图快捷键已配置
    Steps:
      1. 按截图快捷键（模拟全局快捷键触发）
      2. 验证 overlay 窗口出现
      3. 在 overlay 上模拟拖拽选区 (100,100) → (400,300)
      4. 松开鼠标
      5. 验证 overlay 窗口关闭
      6. 验证截图文件存在: ls ~/.workerbee/screenshots/
      7. 验证当天 log 包含图片引用
    Expected Result: WebP file created in screenshots/, log entry with ![](../screenshots/...) added
    Failure Indicators: No file created, no log entry, overlay stuck open
    Evidence: .sisyphus/evidence/task-9-e2e-flow.txt

  Scenario: ESC 取消截图
    Tool: tauri-agent-control skill
    Steps:
      1. 按截图快捷键触发 overlay
      2. 按 ESC
      3. 验证 overlay 窗口关闭
      4. 验证无新截图文件
      5. 验证 log 无新条目
    Expected Result: Overlay closed, no files created, no log changes
    Evidence: .sisyphus/evidence/task-9-esc-cancel.txt

  Scenario: 快捷键变更生效
    Tool: tauri-agent-control skill
    Steps:
      1. 在 Settings 中修改截图快捷键为 Ctrl+Alt+S
      2. 保存设置
      3. 按新快捷键验证能触发截图
    Expected Result: New shortcut triggers screenshot overlay
    Evidence: .sisyphus/evidence/task-9-shortcut-change.txt
  ```

  **Commit**: YES (groups with T8, T10)
  - Message: `feat(screenshot): wire up hotkey, overlay lifecycle, and log integration`
  - Files: `src-tauri/src/lib.rs`

- [x] 10. Today + LogViewer 截图渲染验证

  **What to do**:
  - 验证 Today 视图和 LogViewer 中截图条目的显示效果
  - Today 视图 (`App.tsx`): 
    - 确认含 `![](path)` 的 log 条目正确显示为缩略图
    - 编辑模式下图片应可点击放大（T7 的 lightbox 已实现）
    - 点击编辑时切换到 MarkdownEditor，图片以 markdown 语法显示
  - LogViewer (`LogViewer.tsx`):
    - 确认历史日志中的图片正确渲染
    - 缩略图大小合适（不撑破布局）
  - 如有问题，修复 CSS 样式或组件逻辑
  - 确保 `convertFileSrc` 在两个视图中都正确转换路径

  **Must NOT do**:
  - 不修改 log 条目的解析逻辑（parseLogEntries）
  - 不修改编辑/保存的交互模式

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要验证两个视图的图片渲染、处理路径转换问题、CSS 修复
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T8, T9)
  - **Blocks**: FINAL
  - **Blocked By**: T7

  **References**:

  **Pattern References**:
  - `src/App.tsx` — Today 视图渲染逻辑，确认图片在 click-to-edit 模式下的显示
  - `src/components/LogViewer.tsx` — LogViewer 渲染逻辑，确认历史日志中的图片显示
  - `src/components/MarkdownPreview.tsx` — T7 添加的 lightbox 功能

  **WHY Each Reference Matters**:
  - Today 视图使用 inline 编辑（click-to-edit），需要确认图片在此模式下不破坏布局
  - LogViewer 使用相同的渲染模式，需要确认一致性

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Today 视图显示截图缩略图
    Tool: Playwright
    Steps:
      1. Create a log entry with image reference for today
      2. Navigate to Today tab
      3. Verify image renders as thumbnail
      4. Click image → verify lightbox opens
      5. Click on text area → verify edit mode shows markdown syntax
    Expected Result: Thumbnail visible, lightbox works, edit mode shows ![](path)
    Evidence: .sisyphus/evidence/task-10-today-thumbnail.png

  Scenario: LogViewer 历史日志显示截图
    Tool: Playwright
    Steps:
      1. Navigate to Logs tab
      2. Select a date that has log entries with images
      3. Verify images render correctly
      4. Verify layout is not broken by large images
    Expected Result: Images render as thumbnails without layout issues
    Evidence: .sisyphus/evidence/task-10-logviewer-images.png
  ```

  **Commit**: YES (groups with T8, T9)
  - Message: `feat(screenshot): verify and fix image rendering in Today and LogViewer`
  - Files: `src/App.tsx, src/components/LogViewer.tsx, src/components/MarkdownPreview.tsx`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npx tsc --noEmit` + `cargo check`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | TypeScript [PASS/FAIL] | Rust [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `tauri-agent-control` skill)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test the complete screenshot flow end-to-end: hotkey → selection → save → view in Today → click expand → AI report with image. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(screenshot): add dependencies and types for screenshot feature` - Cargo.toml, lib.rs (AppConfig), api.ts, screenshot-overlay.html, vite.config.ts, i18n files
- **Wave 2**: `feat(screenshot): implement capture, overlay, and settings UI` - lib.rs (commands), screenshot-overlay/, App.tsx, MarkdownPreview.tsx
- **Wave 3**: `feat(screenshot): integrate hotkey, AI vision, and log display` - lib.rs (hotkey), generate.ts, App.tsx, LogViewer.tsx
- **Final**: `feat(screenshot): complete screenshot feature with QA verification` - evidence files

---

## Success Criteria

### Verification Commands
```bash
cargo check                                              # Expected: Compiles without errors
npx tsc --noEmit                                         # Expected: No type errors
ls ~/.workerbee/screenshots/                             # Expected: WebP files exist after screenshot
cat ~/.workerbee/logs/$(date +%Y-%m-%d).md | grep "!\["  # Expected: Contains image references
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] Screenshot hotkey triggers overlay successfully
- [ ] Region selection crops correctly
- [ ] WebP saved to screenshots/ directory
- [ ] Log entry with image reference auto-inserted
- [ ] Thumbnails visible in Today/LogViewer
- [ ] Click-to-expand works on images
- [ ] AI report includes screenshot content
- [ ] Settings allows configuring screenshot shortcut
