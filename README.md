# WorkerBee

通过点滴记录构建工作日志的桌面应用。随时记录，积累回顾。

## 这是什么

WorkerBee 解决一个简单的问题：**工作日志总是事后补，而且总想不起来做了什么。**

它提供一个全局快捷键呼出的轻量输入框，让你在工作过程中随手记一笔。记录按日期自动存为 Markdown 文件，后续可用于生成日报、周报等报告。

## 核心特性

- **全局快捷输入** — `Ctrl+Shift+Space`（可自定义）随时呼出无边框输入窗口，写完回车提交，ESC 关闭
- **文件编辑器风格** — 今日视图采用「点击即编辑、失焦即保存」的交互，像编辑纯文本文件一样自然
- **Markdown 存储** — 所有记录以 `YYYY-MM-DD.md` 格式保存在本地，纯文本，你的数据你做主
- **深色 / 浅色主题** — 支持跟随系统、浅色、深色三种模式，深色模式使用极简零色度配色
- **多语言** — 支持简体中文、English、日本語、한국어，默认跟随系统语言
- **系统托盘** — 关闭窗口不退出，最小化到托盘继续运行
- **首次引导** — 新用户启动后引导选择存储目录，开箱即用

## 数据结构

```
~/.workerbee/
├── .workerbee.config.json  # 应用配置
├── logs/                   # 点滴记录
│   ├── 2026-04-13.md
│   ├── 2026-04-14.md
│   └── ...
└── reports/                # 生成的报告（预留）
```

每条记录的格式：

```markdown
---
date: 2026-04-14
---

## 14:30

讨论了Q2规划，结论是...

## 15:00

写代码修复了登录bug
```

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | [Tauri v2](https://v2.tauri.app/) (Rust) |
| 前端 | React 19 + TypeScript |
| 样式 | Tailwind CSS v4 + shadcn/ui |
| 构建 | Vite 7 |

## 开发

```bash
# 安装依赖
npm install

# 启动开发模式（前端 + Rust 后端热重载）
npm run tauri dev

# 构建生产版本
npm run tauri build
```

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [VS Code](https://code.visualstudio.com/) + [Tauri 扩展](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 项目结构

```
src/                          # 前端源码
├── App.tsx                   # 主窗口（今日视图 / 日志浏览 / 设置）
├── main.tsx                  # 入口
├── quick-input/              # 快捷输入窗口（独立页面）
├── components/
│   ├── LogViewer.tsx         # 日志浏览
│   ├── SetupGuide.tsx        # 首次引导
│   ├── ShortcutsHelpDialog.tsx
│   ├── ShortcutRecorder.tsx
│   └── ui/                   # shadcn/ui 组件
├── lib/
│   ├── api.ts                # Tauri IPC 封装 + 类型定义
│   ├── i18n/                 # 国际化模块
│   │   ├── index.ts
│   │   └── locales/          # 语言文件（zh-CN / en / ja / ko）
│   └── utils.ts
src-tauri/                    # Rust 后端
├── src/lib.rs                # 应用逻辑、窗口管理、文件读写、全局快捷键、系统托盘
├── Cargo.toml
└── tauri.conf.json           # Tauri 配置
```

## License

Private
