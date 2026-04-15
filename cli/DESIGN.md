# WorkerBee CLI 开发设计

## 1. 概述

CLI 是独立工具，面向 Agent，用于读取数据和校验格式。

**与 Tauri 的关系：** 无直接通信，共用同一数据目录 `~/.workerbee/`。

---

## 2. 目录结构

```
workerbee-cli/
├── Cargo.toml
└── src/
    └── main.rs
```

---

## 3. 命令清单

| 命令 | 说明 | 输出 |
|------|------|------|
| `workerbee locate` | 返回数据目录结构 | JSON |
| `workerbee spec` | 输出记录格式规范 | Markdown |
| `workerbee validate <file>` | 校验文件格式 | JSON + exit code |
| `workerbee template list` | 列出模板 | JSON |
| `workerbee template get <name>` | 获取模板内容 | Markdown |
| `workerbee config` | 查看配置 | JSON |

---

## 4. 数据目录定位

**优先级：**
1. 环境变量 `WORKERBEE_DATA_DIR`
2. 配置文件 `~/.workerbee/.workerbee.config.json` 中的 `data_dir`
3. 默认路径 `~/.workerbee`

```rust
fn get_data_dir() -> PathBuf {
    // 1. 环境变量
    if let Ok(dir) = env::var("WORKERBEE_DATA_DIR") {
        return PathBuf::from(dir);
    }

    // 2. 配置文件中读取
    let config_path = dirs::home_dir()
        .unwrap()
        .join(".workerbee")
        .join(".workerbee.config.json");
    if let Ok(content) = fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str::<Config>(&content) {
            return PathBuf::from(config.storage_path);
        }
    }

    // 3. 默认值
    dirs::home_dir().unwrap().join(".workerbee")
}
```

---

## 5. 命令详解

### 5.1 `workerbee locate`

返回数据目录结构。

**输出：**
```json
{
  "data_dir": "/home/user/.workerbee",
  "config": "/home/user/.workerbee/.workerbee.config.json",
  "logs": "/home/user/.workerbee/logs",
  "reports": "/home/user/.workerbee/reports",
  "templates": "/home/user/.workerbee/templates"
}
```

### 5.2 `workerbee spec`

输出记录格式规范（Markdown），内容见 `SPEC.md`。

### 5.3 `workerbee validate <file>`

校验指定文件是否符合记录格式规范。

**参数：**
- `<file>`：文件路径（必填）

**输出（合规）：**
```json
{
  "valid": true,
  "file": "/home/user/.workerbee/logs/2026-04-13.md",
  "errors": []
}
```

**输出（不合规）：**
```json
{
  "valid": false,
  "file": "/home/user/.workerbee/logs/2026-04-13.md",
  "errors": [
    {
      "line": 15,
      "message": "缺少时间锚点，应使用 ## HH:mm 格式"
    }
  ]
}
```

**校验规则（逐项检查）：**
1. 文件名符合 `YYYY-MM-DD.md`
2. 存在 front-matter，包含 `date` 字段
3. `date` 字段格式为 `YYYY-MM-DD`
4. 每个时间锚点符合 `## HH:mm` 格式
5. 时间锚点位于行首

**退出码：**
- `0` - 校验通过
- `1` - 校验失败

### 5.4 `workerbee template list`

列出所有模板。

**输出：**
```json
{
  "templates": ["日报", "周报", "月报", "季报", "年报"]
}
```

### 5.5 `workerbee template get <name>`

获取指定模板内容。

**参数：**
- `<name>`：模板名称（必填），如 `日报`

**输出：** 直接输出模板 Markdown 内容

**错误：** 模板不存在时返回错误信息 + exit code 2

### 5.6 `workerbee config`

查看当前配置。

**输出：**
```json
{
  "data_dir": "/home/user/.workerbee",
  "hotkey": "ctrl+shift+space",
  "created_at": "2026-04-13T10:00:00Z"
}
```

---

## 6. 错误处理

| 错误类型 | 退出码 | 说明 |
|----------|--------|------|
| 成功 | 0 | 正常执行 |
| 格式错误 | 1 | validate 校验失败 |
| 文件不存在 | 2 | 指定的文件/模板不存在 |
| 配置错误 | 3 | 配置文件损坏或缺失 |

---

## 7. 输出格式约定

- 所有命令默认输出纯文本
- 错误信息输出到 stderr
- 成功结果输出到 stdout

---

## 8. 依赖清单

```toml
[dependencies]
clap = { version = "4", features = ["derive"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
dirs = "6"
chrono = "0.4"
```

---

## 9. 代码结构

```rust
// main.rs

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "workerbee")]
#[command(version = "0.1.0")]
enum Cli {
    /// 返回数据目录结构
    Locate,
    /// 输出记录格式规范
    Spec,
    /// 校验文件格式
    Validate {
        /// 文件路径
        file: String,
    },
    /// 列出模板
    Template {
        #[command(subcommand)]
        action: TemplateAction,
    },
    /// 查看配置
    Config,
}

#[derive(Subcommand)]
enum TemplateAction {
    /// 列出所有模板
    List,
    /// 获取模板内容
    Get {
        /// 模板名称
        name: String,
    },
}

fn main() {
    let cli = Cli::parse();
    // match cli 执行对应命令
}
```

---

## 10. 构建

```bash
cargo build --release
# 输出: target/release/workerbee (Linux/macOS)
#       target/release/workerbee.exe (Windows)
```
