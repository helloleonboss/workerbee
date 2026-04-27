use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "workerbee",
    version,
    about = "WorkerBee CLI — 工作日志数据接口",
    long_about = "WorkerBee CLI 工具。\
        \n\n提供数据目录信息、日志读取、配置查询等能力。\
        \n所有子命令输出 JSON 格式，方便 agent 或脚本解析。\
        \n\n数据目录：~/.workerbee/\
        \n  logs/YYYY-MM-DD.md  — 每日工作日志\
        \n  reports/*.md        — 生成的报告\
        \n  templates/*.md      — 报告模板\
        \n  screenshots/        — 截图文件"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// 查看数据目录结构、格式说明、配置摘要。
    /// 这是 agent 入口：运行此命令即可了解所有数据格式和文件位置。
    Inspect,

    /// 管理工作日志
    Logs {
        #[command(subcommand)]
        action: LogActions,
    },

    /// 管理报告模板。
    /// 生成报告前应先读取模板，按模板要求生成。
    Templates {
        #[command(subcommand)]
        action: TemplateActions,
    },

    /// 管理报告
    Reports {
        #[command(subcommand)]
        action: ReportActions,
    },

    /// 查看应用配置（AI 模型、主题、语言等）
    Config,
}

#[derive(Subcommand)]
enum LogActions {
    /// 列出日志日期。可用 --from/--to 按范围过滤。
    ///
    /// 示例:
    ///   workerbee logs list
    ///   workerbee logs list --from 2026-04-18 --to 2026-04-24
    List {
        /// 起始日期（YYYY-MM-DD）
        #[arg(long)]
        from: Option<String>,

        /// 结束日期（YYYY-MM-DD）
        #[arg(long)]
        to: Option<String>,
    },

    /// 读取某一天的完整日志
    ///
    /// 示例:
    ///   workerbee logs read 2026-04-24
    Read {
        /// 日期（YYYY-MM-DD）
        date: String,
    },

    /// 读取日期范围内的所有日志（拼接输出）
    /// 适合生成周报/月报时一次性获取全部内容。
    ///
    /// 示例:
    ///   workerbee logs read-range --from 2026-04-18 --to 2026-04-24
    ReadRange {
        /// 起始日期（YYYY-MM-DD）
        #[arg(long)]
        from: String,

        /// 结束日期（YYYY-MM-DD）
        #[arg(long)]
        to: String,
    },

    /// 追加一条日志到今天
    ///
    /// 示例:
    ///   workerbee logs add "讨论了Q2规划"
    Add {
        /// 日志内容
        content: String,
    },
}

#[derive(Subcommand)]
enum TemplateActions {
    /// 列出所有可用模板
    List,

    /// 读取模板内容（格式要求、prompt、文件名规则）。
    /// 生成报告前必须先运行此命令了解模板要求。
    ///
    /// 示例:
    ///   workerbee templates show 日报
    Show {
        /// 模板文件名（不含 .md 后缀）
        name: String,
    },

    /// 创建报告模板。
    /// 模板定义了报告的格式要求和 prompt，生成报告时会自动匹配。
    ///
    /// 示例:
    ///   workerbee templates create 月报 --date-range month --prompt "# 目标\n\n生成月报"
    Create {
        /// 模板名称（如：日报、周报、月报、季报、年报）
        name: String,

        /// 日期范围: today / week / month / quarter / year
        #[arg(long)]
        date_range: Option<String>,

        /// 模板 prompt 内容（格式要求、生成指令等）
        #[arg(long)]
        prompt: String,
    },
}

#[derive(Subcommand)]
enum ReportActions {
    /// 列出所有报告文件
    List,

    /// 生成报告：自动检查模板、收集日志，返回生成所需的全部信息。
    ///
    /// 流程：
    ///   1. 查找对应类型的模板
    ///   2. 有模板 → 返回 template + logs (status: ready)
    ///   3. 无模板 → 返回 template_required，引导创建模板
    ///   4. 加 --skip-template 可跳过模板检查
    ///
    /// 示例:
    ///   workerbee reports generate --type monthly --from 2026-04-01 --to 2026-04-30
    ///   workerbee reports generate --type 月报 --from 2026-04-01 --to 2026-04-30 --skip-template
    Generate {
        /// 报告类型: daily/日报, weekly/周报, monthly/月报, quarterly/季报, annual/年报
        #[arg(long)]
        r#type: String,

        /// 起始日期（YYYY-MM-DD）
        #[arg(long)]
        from: String,

        /// 结束日期（YYYY-MM-DD）
        #[arg(long)]
        to: String,

        /// 跳过模板检查，直接收集日志生成（仅在明确不需要模板时使用）
        #[arg(long)]
        skip_template: bool,
    },
}

/// Run a fallible command and output JSON on success, or error to stderr on failure.
fn run(result: Result<serde_json::Value, String>) {
    match result {
        Ok(value) => {
            println!("{}", serde_json::to_string_pretty(&value).unwrap());
        }
        Err(e) => {
            eprintln!("{}", e);
            std::process::exit(1);
        }
    }
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Inspect => {
            run(Ok(workerbee_lib::cli::cli_inspect()));
        }

        Commands::Logs { action } => match action {
            LogActions::List { from, to } => {
                run(workerbee_lib::cli::cli_list_logs(from.as_deref(), to.as_deref()));
            }
            LogActions::Read { date } => {
                run(workerbee_lib::cli::cli_read_log(&date));
            }
            LogActions::ReadRange { from, to } => {
                run(workerbee_lib::cli::cli_read_range(&from, &to));
            }
            LogActions::Add { content } => {
                run(workerbee_lib::cli::cli_add_log(&content));
            }
        },

        Commands::Templates { action } => match action {
            TemplateActions::List => {
                run(workerbee_lib::cli::cli_list_templates());
            }
            TemplateActions::Show { name } => {
                run(workerbee_lib::cli::cli_show_template(&name));
            }
            TemplateActions::Create {
                name,
                date_range,
                prompt,
            } => {
                run(workerbee_lib::cli::cli_create_template(
                    &name,
                    date_range.as_deref(),
                    &prompt,
                ));
            }
        },

        Commands::Reports { action } => match action {
            ReportActions::List => {
                run(workerbee_lib::cli::cli_list_reports());
            }
            ReportActions::Generate {
                r#type,
                from,
                to,
                skip_template,
            } => {
                run(workerbee_lib::cli::cli_generate_report(
                    &r#type,
                    &from,
                    &to,
                    skip_template,
                ));
            }
        },

        Commands::Config => {
            run(workerbee_lib::cli::cli_config_get());
        }
    }
}
