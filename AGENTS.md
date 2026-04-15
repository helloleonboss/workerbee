# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-14
**Commit:** 4bb96a0
**Branch:** master

## OVERVIEW

WorkerBee — 工作日志点滴记录桌面应用。Tauri v2 (Rust) + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui。全局快捷键呼出无边框窗口快速记录，Markdown 文件存储，支持日报/周报生成（预留）。

## STRUCTURE

```
reportme/
├── index.html                    # 主窗口 HTML
├── quick-input.html              # 快捷输入窗口 HTML（独立入口）
├── vite.config.ts                # 双入口 Vite 配置（main + quick-input）
├── src/
│   ├── main.tsx                  # 主窗口 React 入口
│   ├── App.tsx                   # 根组件（TodayView/LogViewer/SettingsView，~710 行）
│   ├── index.css                 # Tailwind v4 @theme + shadcn CSS 变量
│   ├── quick-input/
│   │   ├── main.tsx              # 快捷输入窗口独立 React 入口
│   │   └── QuickInputApp.tsx     # 快捷输入组件（无边框浮动窗口）
│   ├── components/
│   │   ├── LogViewer.tsx         # 日志浏览（日期侧栏 + 行内编辑）
│   │   ├── SetupGuide.tsx        # 首次启动引导（选择存储目录）
│   │   ├── ShortcutRecorder.tsx  # 快捷键录制组件
│   │   ├── ShortcutsHelpDialog.tsx # 快捷键帮助（仅渲染 DialogContent）
│   │   ├── QuickInput.tsx        # 备用快速输入组件
│   │   └── ui/                   # shadcn/ui 组件（Button/Card/Dialog/Input/Select/Tabs/Textarea/ScrollArea）
│   └── lib/
│       ├── api.ts                # 所有 Tauri IPC invoke() 封装 + AppConfig 类型
│       ├── utils.ts              # cn()、formatCurrentDate/Time、parseLogEntries
│       └── i18n/
│           ├── index.ts          # 轻量 i18n（t()/setLocale()/initLocale()）
│           └── locales/          # zh-CN.json / en.json / ja.json / ko.json
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               # 二进制入口，调用 workerbee_lib::run()
│   │   └── lib.rs                # 全部 Rust 逻辑（~441 行）：配置/文件IO/快捷键/窗口/托盘
│   ├── Cargo.toml                # lib 名 workerbee_lib（Windows 命名冲突 workaround）
│   ├── tauri.conf.json           # 仅声明 main 窗口，quick-input 在 Rust 中动态创建
│   └── capabilities/default.json # Tauri v2 权限（core/opener/global-shortcut/dialog/tray）
└── doc/
    └── 方案.md                    # 设计文档
```

## WHERE TO LOOK

| 任务 | 位置 | 备注 |
|------|------|------|
| 添加新 Tauri 命令 | `src-tauri/src/lib.rs` + `src/lib/api.ts` | Rust 端加 `#[tauri::command]`，TS 端加 invoke 封装 |
| 修改主窗口 UI | `src/App.tsx` | TodayView/SettingsView 内联在此文件 |
| 修改快捷输入窗口 | `src/quick-input/QuickInputApp.tsx` | 独立窗口，独立 React 根 |
| 添加/修改 i18n 文案 | `src/lib/i18n/locales/*.json` | 四个语言文件同步修改 |
| 修改主题/颜色 | `src/index.css` | `@theme` 块 + `.dark` 块，oklch 色值 |
| 添加 shadcn 组件 | `src/components/ui/` | 标准 forwardRef + cn() 模式 |
| 修改日志编辑交互 | `src/App.tsx` TodayView + `src/components/LogViewer.tsx` | 两者有相似的行内编辑逻辑 |
| 修改全局快捷键 | `src-tauri/src/lib.rs` setup() | Rust 端注册，JS 端同步状态 |
| 修改系统托盘 | `src-tauri/src/lib.rs` setup() | 菜单项 + 事件处理 |

## CODE MAP

### Rust 命令（src-tauri/src/lib.rs）

| 命令 | 用途 |
|------|------|
| `get_config` / `save_config` | 配置读写，快捷键变更时自动重新注册 |
| `save_log(date, time, content)` | 追加条目到 `logs/YYYY-MM-DD.md` |
| `read_log(date)` / `write_log(date, content)` | 读写完整日志文件（编辑/删除用） |
| `list_logs` / `list_reports` | 列出 logs/ 和 reports/ 下的文件名 |
| `choose_folder` | 原生文件夹选择对话框 |
| `show_quick_input_cmd` / `hide_quick_input` | 控制快捷输入窗口显隐 |

### TypeScript IPC 函数（src/lib/api.ts）

所有 Rust 命令在 `api.ts` 中有类型化封装：`getConfig()`, `saveConfig()`, `saveLog()`, `readLog()`, `writeLog()`, `listLogs()`, `chooseFolder()` 等。

### 关键类型

```typescript
// src/lib/api.ts
type Theme = "light" | "dark" | "system";
interface AppConfig { storage_path: string; shortcut: string; theme?: Theme; show_hint_bar?: boolean; locale?: string; }

// src/lib/utils.ts
interface LogEntry { time: string; content: string; }
```

## TWO-WINDOW MODEL

| 窗口 | HTML 入口 | React 入口 | 创建方式 |
|------|----------|-----------|---------|
| Main | `index.html` | `src/main.tsx` → `App` | `tauri.conf.json` 声明 |
| Quick Input | `quick-input.html` | `src/quick-input/main.tsx` → `QuickInputApp` | `lib.rs` setup() 中动态创建 |

**跨窗口通信：**
- Rust `emit("quick-input-shown", config)` → QuickInputApp 监听，同步主题和配置
- Rust `emit("navigate-to-settings")` → App.tsx 监听，切换到设置页
- Quick Input 保存后，主窗口通过 `focusChanged` 事件刷新数据

## CONVENTIONS

- **i18n**: 所有 UI 文字用 `t("section.key")`，不硬编码字符串。新增 key 需同步四个语言文件
- **组件**: 优先使用 shadcn/ui 组件（Select/Dialog/Card 等），不自己造轮子
- **样式**: 颜色用 CSS 变量（`--color-*`），深色模式在 `.dark` 块中覆盖，使用 oklch 色彩空间
- **路径别名**: `@/` → `./src/`（tsconfig.json + vite.config.ts 同步配置）
- **快捷键**: 在 Rust 端注册和管理，JS 端仅同步状态
- **编辑交互**: 点击即编辑、blur 自动保存、清空内容 + blur = 删除条目
- **窗口行为**: 关闭主窗口 = 隐藏到托盘（不退出）；关闭快捷输入 = 隐藏（不销毁）
- **配置**: `AppConfig` 在 Rust 中用 `#[serde(default = "fn")]` 设默认值，TS 端类型保持同步

## ANTI-PATTERNS

- **不要** 用 `as any`、`@ts-ignore`、`@ts-expect-error` 压制类型错误
- **不要** 在前端注册/管理全局快捷键（由 Rust 端负责）
- **不要** 在 `tauri.conf.json` 中声明 quick-input 窗口（由 Rust 动态创建）
- **不要** 在快捷输入窗口中加 header/decoration（设计为无边框浮动窗口）
- **不要** 编辑态添加视觉放大效果（仅靠光标标识编辑状态）
- **不要** 嵌套 Radix Dialog（ShortcutsHelpDialog 仅渲染 DialogContent，外层由调用方提供 `<Dialog>`）
- **不要** 使用 `setLocale("system")` 切换语言（不改变 locale，保持浏览器检测结果）

## COMMANDS

```bash
npm install              # 安装依赖
npm run tauri dev        # 启动开发模式（前端 + Rust 热重载）
npm run tauri build      # 构建生产版本
```

环境要求：Node.js >= 18、Rust stable、VS Code + Tauri 扩展 + rust-analyzer

## DATA FORMAT

日志存储为 Markdown 文件 `logs/YYYY-MM-DD.md`：

```markdown
---
date: 2026-04-14
---

## 14:30

讨论了Q2规划

## 15:00

修复了登录bug
```

- 时间锚点：`## HH:mm`
- 无标签，保持口语化
- 支持补录过去时间

## NOTES

- `lib.rs` 库名 `workerbee_lib` 是 Windows 命名冲突 workaround，不影响使用
- 配置文件位于 `~/.workerbee/.workerbee.config.json`（不再使用 app_data_dir）
- `QuickInputApp.tsx` 有独立的 `formatCurrentTime/Date` 和 `applyTheme`（不复用 lib/），因为独立窗口入口不能共享模块
- `parseLogEntries()` 是 Markdown → `LogEntry[]` 的唯一解析入口
- `saveEdit()` 的 blur 处理直接从 DOM 元素取值，避免 React state 批量更新延迟
- `ShortcutRecorder` 将浏览器 KeyboardEvent 转为 Tauri 快捷键字符串格式（如 `CommandOrControl+Shift+Space`）
- 无 ESLint/Prettier 配置，依赖 TypeScript strict mode + 编辑器设置
