# 快捷截图功能优化修复

## TL;DR

> **Quick Summary**: 修复快捷截图功能中的 6 类问题：死代码清理、多显示器坐标偏移、临时文件泄漏、错误处理、UI 体验改进。
> 
> **Deliverables**:
> - `src-tauri/src/lib.rs` — 重构截图后端逻辑
> - `src/screenshot-overlay/main.tsx` — 改进前端 UI 和错误处理
> - `src/lib/api.ts` — 移除废弃 API
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Rust 后端修复 → 前端修复 → 构建验证

---

## Context

### 审核发现的问题

| # | 严重度 | 问题 | 影响 |
|---|--------|------|------|
| 1 | 🔴 | `capture_screens` 是死代码 + 快捷键注册重复 | 代码冗余，维护负担 |
| 2 | 🔴 | 多显示器坐标未考虑 monitor offset | 副屏截图裁剪区域错误 |
| 3 | 🔴 | 临时 BMP 文件未清理 | 磁盘泄漏 |
| 4 | 🔴 | 前端使用 `alert()` 报错 | 体验差，错误信息不可靠 |
| 5 | 🟡 | 选区尺寸标签可能溢出屏幕 | 用户看不到尺寸信息 |
| 6 | 🟡 | `get_screenshot_overlay_data` 使用 `take()` 消费数据 | 重试时数据丢失 |
| 7 | 🟢 | 截图保存后无视觉反馈 | 用户不确定是否成功 |
| 8 | 🟢 | 快捷键注册代码重复 ~30 行 | 可提取辅助函数 |

---

## Work Objectives

### Core Objective
修复快捷截图功能中的所有已知问题，提升代码质量和用户体验。

### Definition of Done
- [ ] `cargo check` 无错误无警告
- [ ] `npx tsc --noEmit` 无错误
- [ ] 截图功能在单显示器和多显示器下均正常工作

### Must Have
- 所有 🔴 严重问题必须修复
- 所有 🟡 中等问题必须修复
- 快捷键注册逻辑提取为辅助函数

### Must NOT Have (Guardrails)
- 不改变截图功能的整体架构（overlay → 选区 → 裁剪 → 保存）
- 不引入新的依赖
- 不修改 `AppConfig` 结构体（不破坏配置兼容性）
- 不使用 `as any`、`@ts-ignore`

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (vitest)
- **Automated tests**: None (截图功能难以单元测试)
- **Agent-Executed QA**: 全部通过 Rust 编译 + TypeScript 类型检查验证

### QA Policy
- Rust: `cargo check` 通过即视为后端正确
- TypeScript: `npx tsc --noEmit` 通过即视为前端正确

---

## Execution Strategy

### Wave 1 (Rust 后端修复 — 可并行):
├── Task 1: 提取快捷键注册辅助函数 + 删除死代码 [quick]
├── Task 2: 修复多显示器坐标偏移 + 临时文件清理 [deep]
└── Task 3: 修复 `take()` → `clone()` + 错误处理改进 [quick]

### Wave 2 (前端修复 — 依赖 Wave 1):
├── Task 4: 修复选区标签溢出 + 替换 alert() [quick]
└── Task 5: 添加保存成功视觉反馈 [quick]

### Wave 3 (验证):
└── Task 6: 编译验证 [quick]

### Dependency Matrix
- **1**: 无依赖 → 无下游
- **2**: 无依赖 → 无下游
- **3**: 无依赖 → 无下游
- **4**: 依赖 1, 2, 3
- **5**: 依赖 4
- **6**: 依赖 1-5

---

## TODOs

- [ ] 1. 提取快捷键注册辅助函数 + 删除 `capture_screens` 死代码

  **What to do**:
  - 在 `lib.rs` 中新增 `register_shortcut(app, shortcut_str, label)` 辅助函数
  - 替换 `setup()` 中两处重复的快捷键注册代码（约 L1006-1037）
  - 删除 `capture_screens` 函数（L765-797）
  - 从 `invoke_handler` 中移除 `capture_screens`（L1161）
  - 从 `src/lib/api.ts` 中删除 `captureScreens` 函数（L204-206）

  **Must NOT do**:
  - 不修改快捷键的实际注册逻辑（行为保持一致）
  - 不删除 `capture_screens` 以外的任何 command

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 代码删除 + 简单函数提取，范围明确
  - **Skills**: `['git-master']`
    - `git-master`: 提交时使用规范的 commit message

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 4 (api.ts 变更)
  - **Blocked By**: None

  **References**:
  - `src-tauri/src/lib.rs:1006-1037` — 当前重复的快捷键注册代码
  - `src-tauri/src/lib.rs:765-797` — 待删除的 `capture_screens` 函数
  - `src-tauri/src/lib.rs:1161` — invoke_handler 中的 `capture_screens` 引用
  - `src/lib/api.ts:204-206` — 待删除的 `captureScreens` API 封装

  **Acceptance Criteria**:
  - [ ] `cargo check` 通过
  - [ ] `capture_screens` 函数完全删除（grep 无匹配）
  - [ ] `register_shortcut` 函数存在并被调用 2 次

  **Commit**: YES
  - Message: `refactor(screenshot): extract shortcut registration helper, remove dead capture_screens`

---

- [ ] 2. 修复多显示器坐标偏移 + 临时 BMP 文件清理

  **What to do**:
  
  **多显示器坐标修复**：
  - 当前 `show_screenshot_overlay` 将 overlay 窗口定位到 `(mon_x, mon_y)`（显示器物理坐标）
  - 前端 `e.clientX/Y` 是相对于窗口左上角的坐标，而裁剪时直接传给 Rust
  - **问题**：如果窗口定位正确，clientX/Y 相对于窗口 = 相对于显示器，裁剪是正确的
  - **但需要确认**：overlay 窗口大小是否始终等于显示器大小（`set_size` 在 L646-648）
  - 确认逻辑正确后，在 `crop_and_save_screenshot` 中添加注释说明坐标系统
  
  **临时 BMP 文件清理**：
  - 在 `cancel_screenshot` 中删除临时 BMP 文件（`std::env::temp_dir()/workerbee_capture.bmp`）
  - 在 `close_screenshot_overlay` 中同样清理
  - 在 `show_screenshot_overlay` 开始时也清理旧文件（防止上次崩溃残留）
  - 使用 `std::fs::remove_file` 并忽略错误（文件可能不存在）

  **Must NOT do**:
  - 不改变坐标传递方式（当前方案是正确的）
  - 不使用 `tempfile` crate（引入新依赖）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要理解多显示器坐标系统，确保修复正确
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `src-tauri/src/lib.rs:558-661` — `show_screenshot_overlay` 完整流程
  - `src-tauri/src/lib.rs:643-648` — overlay 窗口定位和大小设置
  - `src-tauri/src/lib.rs:610-618` — BMP 临时文件写入位置
  - `src-tauri/src/lib.rs:800-865` — `crop_and_save_screenshot` 裁剪逻辑
  - `src-tauri/src/lib.rs:908-930` — `cancel_screenshot` 当前实现
  - `src-tauri/src/lib.rs:881-896` — `close_screenshot_overlay` 当前实现
  - `src/screenshot-overlay/main.tsx:160-171` — 前端 overlay 渲染，确认窗口大小匹配

  **Acceptance Criteria**:
  - [ ] `cancel_screenshot` 中包含临时文件清理
  - [ ] `close_screenshot_overlay` 中包含临时文件清理
  - [ ] `show_screenshot_overlay` 开始时清理旧临时文件
  - [ ] `crop_and_save_screenshot` 中有坐标系统说明注释
  - [ ] `cargo check` 通过

  **Commit**: YES (with Task 1)
  - Message: `fix(screenshot): cleanup temp BMP files, add coordinate system documentation`

---

- [ ] 3. 修复 `take()` → `clone()` + save_config 快捷键重新注册简化

  **What to do**:
  
  **`take()` → `clone()`**：
  - `get_screenshot_overlay_data` (L899-905) 使用 `state.0.lock().unwrap().take()` 消费数据
  - 改为 `clone()`，数据保留直到 `cancel_screenshot` 或 `close_screenshot_overlay` 清理
  - 这样前端如果重试（比如第一次渲染失败），可以再次获取数据

  **save_config 快捷键重新注册简化**：
  - `save_config` 命令中 (L347-366) 有快捷键重新注册逻辑
  - 当前逻辑手动解析和注册，可以复用新增的 `register_shortcut` 辅助函数
  - 但注意 `save_config` 需要先 unregister 旧快捷键，辅助函数只做 register
  - 保持现有逻辑不变，只在注释中说明原因

  **Must NOT do**:
  - 不改变 `ScreenshotOverlayData` 的生命周期管理

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的 `take()` → `clone()` 替换
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `src-tauri/src/lib.rs:899-905` — `get_screenshot_overlay_data` 使用 `take()`
  - `src-tauri/src/lib.rs:347-366` — save_config 中的快捷键重新注册

  **Acceptance Criteria**:
  - [ ] `get_screenshot_overlay_data` 使用 `clone()` 而非 `take()`
  - [ ] `cargo check` 通过

  **Commit**: YES (with Tasks 1, 2)
  - Message: `fix(screenshot): use clone() instead of take() for overlay data persistence`

---

- [ ] 4. 修复选区标签溢出 + 替换 alert() 为内联错误提示

  **What to do**:
  
  **选区标签智能定位**：
  - 当前标签固定在 `left: sel.x + sel.width + 4, top: sel.y + sel.height + 4`
  - 如果选区靠近右下边缘，标签会溢出
  - 改为：当 `sel.x + sel.width + labelWidth > monitor_width` 时，显示在选区左侧
  - 当 `sel.y + sel.height + labelHeight > monitor_height` 时，显示在选区上方
  - 标签尺寸估算：约 `60px × 20px`（"1920 × 1080" 文本）

  **替换 alert()**：
  - 移除 `alert("保存截图失败: " + error)` (L75)
  - 添加 `errorMessage` state
  - 在 overlay 中显示内联错误提示（红色文字，居中显示）
  - 3 秒后自动清除错误
  - 错误时将错误字符串转为字符串：`String(error)` 而非直接拼接

  **Must NOT do**:
  - 不引入新的 UI 组件库
  - 不改变选区绘制逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 前端 UI 调整，范围明确
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 1-3 completing first)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 5
  - **Blocked By**: Tasks 1, 2, 3

  **References**:
  - `src/screenshot-overlay/main.tsx:59-80` — `handleMouseUp` 包含 alert()
  - `src/screenshot-overlay/main.tsx:198-207` — 尺寸标签渲染
  - `src/screenshot-overlay/main.tsx:160-210` — 整体渲染结构

  **Acceptance Criteria**:
  - [ ] 无 `alert()` 调用
  - [ ] 标签在选区靠近右边缘时显示在左侧
  - [ ] 标签在选区靠近下边缘时显示在上方
  - [ ] `npx tsc --noEmit` 通过

  **Commit**: YES
  - Message: `fix(screenshot): smart label positioning, replace alert with inline error`

---

- [ ] 5. 添加截图保存成功视觉反馈

  **What to do**:
  - 添加 `saveSuccess` state（boolean）
  - 在 `handleMouseUp` 成功保存后，设置 `saveSuccess = true`
  - 在 overlay 中显示绿色 "✓ 已保存" 提示（居中，半透明背景）
  - 1 秒后自动关闭 overlay（已有 `close_screenshot_overlay` 调用）
  - 在显示成功提示时延迟关闭，让用户看到反馈
  
  **具体实现**：
  - 成功时先显示成功提示，延迟 800ms 后调用 `close_screenshot_overlay`
  - 失败时显示错误提示，不关闭 overlay

  **Must NOT do**:
  - 不改变保存逻辑
  - 不引入动画库

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的状态 + UI 反馈
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (after Task 4)
  - **Blocks**: None
  - **Blocked By**: Task 4

  **References**:
  - `src/screenshot-overlay/main.tsx:59-80` — `handleMouseUp` 保存逻辑
  - `src/screenshot-overlay/main.tsx:160-210` — 渲染结构

  **Acceptance Criteria**:
  - [ ] 保存成功后显示 "✓ 已保存" 提示
  - [ ] 提示显示约 800ms 后自动关闭
  - [ ] `npx tsc --noEmit` 通过

  **Commit**: YES (with Task 4)
  - Message: `feat(screenshot): add save success visual feedback`

---

- [ ] 6. 编译验证

  **What to do**:
  - 运行 `cargo check` 验证 Rust 代码
  - 运行 `npx tsc --noEmit` 验证 TypeScript 代码
  - 如果有错误，修复后重新验证

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 编译验证
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (final)
  - **Blocks**: None
  - **Blocked By**: Tasks 1-5

  **Acceptance Criteria**:
  - [ ] `cargo check` 输出 0 errors, 0 warnings
  - [ ] `npx tsc --noEmit` 输出 0 errors

---

## Commit Strategy

- **1-3**: `refactor(screenshot): extract shortcut helper, remove dead code, fix temp file cleanup and data persistence`
  - Files: `src-tauri/src/lib.rs`, `src/lib/api.ts`
- **4-5**: `fix(screenshot): improve overlay UX - smart labels, inline errors, save feedback`
  - Files: `src/screenshot-overlay/main.tsx`

## Success Criteria

### Verification Commands
```bash
cargo check --manifest-path src-tauri/Cargo.toml   # Expected: 0 errors, 0 warnings
npx tsc --noEmit                                    # Expected: 0 errors
```

### Final Checklist
- [ ] `capture_screens` 完全删除
- [ ] `register_shortcut` 辅助函数存在
- [ ] 临时 BMP 文件在 cancel/close 时清理
- [ ] `get_screenshot_overlay_data` 使用 `clone()`
- [ ] 无 `alert()` 调用
- [ ] 选区标签智能定位
- [ ] 保存成功有视觉反馈
- [ ] Rust 编译通过
- [ ] TypeScript 类型检查通过
