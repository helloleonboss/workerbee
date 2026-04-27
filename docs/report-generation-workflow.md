# 报告生成工作流设计

## 概述

用户选择日期范围 → 一键生成报告。AI 自动判断报告类型（日报/周报/月报），拿不准时通过追问卡片让用户确认。全程流式渲染，生成完可预览、编辑、保存。

**不做的事**：对话框、用户手写 prompt、选择模型（用设置里配好的）。

---

## 工作流状态机

```
                    ┌─────────────┐
                    │   IDLE      │  初始状态 / 生成完成
                    │             │
                    └──────┬──────┘
                           │ 用户点击「生成」
                           ▼
                    ┌─────────────┐
                    │  COLLECTING │  收集日志
                    │             │  读取日期范围内的 logs/*.md
                    └──────┬──────┘
                           │ 日志就绪
                           ▼
                    ┌─────────────┐
                    │ GENERATING  │  AI 流式生成
                    │             │  streamText + json-render 流式编译
                    └──────┬──────┘
                           │ 流结束
                           ▼
               ┌───────────────────────┐
               │  AI 输出了什么？       │
               └───────┬───────────────┘
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
     ┌──────────┐ ┌──────────┐ ┌──────────┐
     │ 完整报告  │ │ 追问卡片  │ │ 纯文本   │
     │ (Spec)   │ │ClarifyCard│ │ (fallback)│
     └────┬─────┘ └────┬─────┘ └────┬─────┘
          │            │            │
          ▼            ▼            ▼
     ┌──────────┐ ┌──────────┐ ┌──────────┐
     │ 预览报告  │ │ 用户选择  │ │ Markdown │
     │ 可保存   │ │ 重新生成  │ │ 预览     │
     └──────────┘ └──────────┘ └──────────┘
                       │
                       ▼
                 回到 GENERATING（带上用户回答）
```

---

## 端到端流程

### 1. 用户触发

ReportsView 顶部工具栏：

```
[ 今天 | 本周 | 本月 ]  [✨ 生成报告]
```

- 日期范围三选一：today（当天）、week（近7天含今天）、month（近30天含今天）
- 点击「生成报告」进入 COLLECTING

### 2. 日志收集（前端）

```
输入：dateRange ("today" | "week" | "month")
输出：拼接后的日志文本 + 日期范围标签
```

步骤：
1. `listLogs()` 获取所有日志文件名
2. 按日期范围过滤
3. 逐个 `readLog(date)` 读取内容
4. 拼接格式：`=== 2026-04-14 ===\n{原始内容}\n\n=== 2026-04-15 ===\n{原始内容}`
5. 传给 `generateReport()`

**边界情况**：
- 无日志 → 提示"所选日期范围内没有日志"，不调用 AI
- 部分日志读取失败 → 跳过，继续收集其余的
- 日志总量过大 → 当前不截断（报告场景下 7-30 天的日志通常在模型上下文限制内）

### 3. AI 流式生成

```typescript
// generate.ts 核心流程
const result = streamText({ model, system, prompt });
const compiler = createSpecStreamCompiler();

for await (const chunk of result.textStream) {
  compiler.push(chunk);
  onSpecUpdate(compiler.getResult());  // → UI 实时更新
}
```

#### System Prompt

```
你是一个工作日志报告生成助手。
- 分析日志内容，自动判断报告类型（日报、周报、月报等）
- 如果内容明确，直接生成 ReportPreview + ReportMeta
- 如果日期跨度大或内容杂乱，先输出 ClarifyCard 追问
- 追问最多一次
- 报告使用中文
```

#### User Prompt

```
请根据以下日志内容生成报告。

日期范围：2026-04-14 ~ 2026-04-18

日志内容：
=== 2026-04-14 ===
## 14:30
讨论了Q2规划
## 15:00
修复了登录bug

=== 2026-04-15 ===
...
```

### 4. 流式渲染

json-render 的 `createSpecStreamCompiler` 做增量编译，每收到一个 chunk 就尝试解析并产生新的 Spec patches。

**UI 表现**：
- AI 正在输出 → ReportPreview 卡片逐步"长出来"
- 追问卡片 → ClarifyCard 带选项按钮一次性出现
- 纯文本 fallback → AI 没输出合法 Spec，直接展示原文

### 5. 用户交互（追问场景）

```
┌─────────────────────────────────────┐
│ 🤔 您希望生成哪种类型的报告？       │
│                                     │
│  [ 日报 ]  [ 周报 ]  [ 月报 ]      │
└─────────────────────────────────────┘
```

用户点击选项后：
1. `useStateStore().set("/clarify/answer", "weekly")`
2. `emit("answer_clarify")`
3. ActionProvider 捕获事件 → 用用户回答作为上下文重新调用 `generateReport()`
4. 回到步骤 3（第二次生成不再追问）

### 6. 保存报告

用户点击「保存」后：
1. 从 Spec 中提取 `ReportPreview.props.content`（报告正文）和 `ReportPreview.props.title`
2. 组装为 Markdown：`# {title}\n\n{content}`
3. `writeReport(filename, content)` → 写入 `reports/report-2026-04-18.md`
4. 刷新报告列表，自动选中新保存的报告
5. 清空生成状态，回到 IDLE

### 7. 查看已有报告

保存后的报告进入左侧列表，支持：
- 预览（Markdown 渲染）
- 编辑（CodeMirror 编辑器，blur-to-save）

---

## 数据格式

### AI 输出的 Spec 结构

#### 场景一：直接生成报告

```json
{
  "root": "report",
  "elements": {
    "report": {
      "type": "ReportPreview",
      "props": {
        "title": "周报：2026-04-14 ~ 2026-04-18",
        "dateRange": "2026-04-14 ~ 2026-04-18",
        "content": "## 本周工作\n\n### 项目A\n\n- 完成了...\n\n### 项目B\n\n- 修复了..."
      },
      "children": ["meta", "actions"]
    },
    "meta": {
      "type": "ReportMeta",
      "props": {
        "type": "周报",
        "generatedAt": "2026-04-18T15:30:00",
        "logCount": 12
      }
    },
    "actions": {
      "type": "ActionButton",
      "props": { "label": "保存报告", "variant": "primary", "action": "save_report" }
    }
  }
}
```

#### 场景二：追问

```json
{
  "root": "clarify",
  "elements": {
    "clarify": {
      "type": "ClarifyCard",
      "props": {
        "message": "日志跨度较大，您希望生成哪种类型的报告？",
        "options": [
          { "label": "日报（今日）", "value": "daily" },
          { "label": "周报（汇总）", "value": "weekly" },
          { "label": "重点摘要", "value": "highlights" }
        ]
      }
    }
  }
}
```

### 保存到文件的格式

```markdown
# 周报：2026-04-14 ~ 2026-04-18

## 本周工作

### 项目A

- 完成了用户认证模块重构
- 优化了数据库查询性能

### 项目B

- 修复了登录页面的bug
- 完成了API文档编写

## 下周计划

- 开始支付模块开发
- 准备Q2演示
```

文件路径：`~/.workerbee/reports/report-2026-04-18.md`

---

## 组件职责

### 前端模块

| 模块 | 文件 | 职责 |
|------|------|------|
| **AI Provider** | `src/lib/ai/provider.ts` | 创建 OpenAI-compatible provider 实例 |
| **Catalog** | `src/lib/ai/catalog.ts` | 定义 json-render 组件 schema 和 actions |
| **Registry** | `src/lib/ai/registry.tsx` | Catalog → React 组件映射，处理交互 |
| **Generate** | `src/lib/ai/generate.ts` | 流式生成核心：streamText + Spec 流式编译 |
| **ReportsView** | `src/components/ReportsView.tsx` | UI 层：工具栏 + 列表 + 渲染 + 编辑 |

### Rust 后端（仅存储）

| 命令 | 职责 |
|------|------|
| `list_logs` | 返回所有日志文件名（不含 .md 后缀，降序） |
| `read_log(date)` | 读取 `logs/{date}.md` 全文 |
| `list_reports` | 返回所有报告文件名（不含 .md 后缀，降序） |
| `read_report(filename)` | 读取 `reports/{filename}.md` 全文 |
| `write_report(filename, content)` | 写入 `reports/{filename}.md` |

---

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| AI 未配置 | 生成按钮 disabled + 提示"请先配置 AI" |
| API Key 无效 | onError → 显示错误信息，不清空生成状态 |
| 网络超时 | onError → 显示超时提示 |
| 日志为空 | 提示"所选日期范围内没有日志"，不调用 AI |
| AI 输出非法 JSON | fallback 到纯文本显示 |
| 报告保存失败 | console.error + toast（未来加） |

---

## 未来扩展点

1. **自动生成**：架构已支持——`generateReport()` 可被定时器或事件触发，输入是结构化的
2. **自定义指令**：`GenerateOptions.customInstruction` 已预留，可在工具栏加输入框
3. **重新生成**：`regenerate` action 已注册，可传入反馈指令
4. **更多 provider**：`AI_PROVIDERS` 常量扩展即可
5. **报告模板**：在 system prompt 中加入模板指令，无需改代码
