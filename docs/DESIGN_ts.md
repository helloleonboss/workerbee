# WorkerBee CLI 开发设计

## 1. 概述

CLI 是独立工具，面向 AI Agent，用于追加日志片段。

**设计目标：**
- 省 token：AI 不需要探索文件系统，直接拿到目录结构和用途
- 保证格式：`add` 命令确保日志格式正确，不依赖 AI 生成正确 Markdown

**与 Tauri 的关系：** 无直接通信，共用同一数据目录 `~/.workerbee/`。

---

## 2. 项目结构

```
workerbee-cli/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts          # 入口
    ├── inspect.ts        # inspect 命令
    ├── add.ts            # add 命令
    └── lib/
        ├── data-dir.ts   # 数据目录定位
        ├── log.ts        # 日志追加
        └── errors.ts     # 错误类型与退出码
```

---

## 3. 命令清单

| 命令 | 说明 |
|------|------|
| `workerbee inspect` | 返回目录结构及用途说明 |
| `workerbee add <content>` | 追加内容到今日日志 |

---

## 4. inspect

返回数据目录结构，每个目录附带用途说明。

**输出：**
```json
{
  "data_dir": "~/.workerbee",
  "structure": {
    "templates/": "报告模板目录，存放提示词文件，AI 读后生成对应格式报告",
    "logs/": "日志片段目录，每文件一天，命名 YYYY-MM-DD.md",
    "reports/": "生成的报告目录，AI 生成报告后写入此处"
  }
}
```

AI 看到这个就知道：
- `templates/` → 读模板内容生成报告
- `logs/` → 读日志片段作为素材
- `reports/` → 输出报告的位置

不需要 ls 探索，不需要读文件就知道每个目录干嘛的。

---

## 5. add <content>

将内容追加到今日日志。

**参数：**
- `<content>`：要记录的内容（必填），如 `"讨论了Q2规划，结论是..."`

**行为：**
1. 使用当前系统时间作为时间锚点（格式 `## HH:mm`）
2. 追加到 `~/.workerbee/logs/YYYY-MM-DD.md`
3. 如果文件不存在，自动创建 front-matter

**输出：**
```json
{
  "success": true,
  "file": "~/.workerbee/logs/2026-04-14.md",
  "time": "14:30"
}
```

**示例：**
```bash
workerbee add "讨论了Q2规划，结论是..."
# → 追加到 logs/2026-04-14.md，内容：
# ## 14:30
# 讨论了Q2规划，结论是...
```

---

## 6. 日志格式

日志以 Markdown 存储，文件命名 `YYYY-MM-DD.md`，内容格式：

```markdown
---
date: 2026-04-14
---

## 14:30

讨论了Q2规划

## 15:00

修复了登录bug
```

格式规则：
- `## HH:mm` 作为时间锚点
- 时间锚点后空一行跟内容
- 无 front-matter 时 `add` 自动创建

---

## 7. 错误处理

| 错误类型 | 退出码 |
|----------|--------|
| 成功 | 0 |
| 文件不存在（add 场景） | 1 |
| 配置错误 | 3 |

---

## 8. 依赖清单

```json
{
  "dependencies": {
    "commander": "^12.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "tsx": "^4.0.0"
  }
}
```

---

## 9. 代码结构

### 入口 `src/index.ts`

```typescript
#!/usr/bin/env node

import { Command } from "commander";
import { handleInspect } from "./inspect.js";
import { handleAdd } from "./add.js";

const program = new Command();

program
  .name("workerbee")
  .version("0.1.0")
  .description("WorkerBee CLI - 日志追加工具");

program
  .command("inspect")
  .description("返回目录结构及用途说明")
  .action(handleInspect);

program
  .command("add <content>")
  .description("追加内容到今日日志")
  .action(handleAdd);

program.parse();
```

### 数据目录 `src/lib/data-dir.ts`

```typescript
import os from "os";
import path from "path";
import fs from "fs";

export function getDataDir(): string {
  // 1. 环境变量
  if (process.env.WORKERBEE_DATA_DIR) {
    return process.env.WORKERBEE_DATA_DIR;
  }

  // 2. 配置文件中读取
  const configPath = path.join(os.homedir(), ".workerbee", ".workerbee.config.json");
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(content) as { storage_path?: string };
    if (config.storage_path) {
      return config.storage_path;
    }
  } catch {
    // 忽略，继续使用默认值
  }

  // 3. 默认值
  return path.join(os.homedir(), ".workerbee");
}
```

### 日志追加 `src/lib/log.ts`

```typescript
import fs from "fs";
import path from "path";

export function addLogEntry(content: string): { success: boolean; file: string; time: string } {
  const now = new Date();
  const dateStr = formatDate(now);
  const timeStr = formatTime(now);

  const dataDir = getDataDir();
  const logsDir = path.join(dataDir, "logs");
  const filePath = path.join(logsDir, `${dateStr}.md`);

  fs.mkdirSync(logsDir, { recursive: true });

  let fileContent = "";
  if (fs.existsSync(filePath)) {
    fileContent = fs.readFileSync(filePath, "utf-8");
  } else {
    fileContent = `---\ndate: ${dateStr}\n---\n`;
  }

  const entry = `\n## ${timeStr}\n\n${content}\n`;
  const newContent = fileContent.trimEnd() + entry;

  fs.writeFileSync(filePath, newContent, "utf-8");

  return { success: true, file: filePath, time: timeStr };
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
```

### inspect 命令 `src/inspect.ts`

```typescript
import { getDataDir } from "./lib/data-dir.js";

export function handleInspect(): void {
  const dataDir = getDataDir();

  const result = {
    data_dir: dataDir,
    structure: {
      "templates/": "报告模板目录，存放提示词文件，AI 读后生成对应格式报告",
      "logs/": "日志片段目录，每文件一天，命名 YYYY-MM-DD.md",
      "reports/": "生成的报告目录，AI 生成报告后写入此处",
    },
  };

  console.log(JSON.stringify(result, null, 2));
}
```

---

## 10. AI 使用流程

1. `workerbee inspect` → 知道目录结构和用途
2. AI 直接读文件（不需要 CLI）：
   - `cat ~/.workerbee/templates/日报.md` → 读模板
   - `cat ~/.workerbee/logs/2026-04-14.md` → 读日志
3. `workerbee add "讨论了Q2规划"` → 补录工作片段（必须用 CLI 保证格式）
4. AI 生成报告后自己写到 `reports/` 下

---

## 11. 构建

```bash
npx tsc
npm link   # 链接到全局
# 输出: dist/index.js
```