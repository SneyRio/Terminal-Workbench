# WbSpace 1.3.0 验收

111 项单元测试、类型检查与生产前端构建通过；`agent-official-regression`、`schedule-regression`、`agent-protocol-regression`、`quota-footer-regression`、`schedule-session-regression` 通过。打包后的 `release-readiness-regression` 与 Windows 冒烟（含 MCP、CLI 工具传入 Codex / Qoder / OpenCode 的断言）由 CI 执行。

- 状态栏继承：账号目录为空时，读取 `~/.claude/settings.json` 中的 claude-hud 命令，并以 `~/.claude` 为配置目录运行，本机真实 claude-hud 正常输出。
- 内置 claude-hud 0.10.0：经 Electron（`ELECTRON_RUN_AS_NODE`）由遥测脚本调起，在空账号目录中输出中文 HUD（上下文、用量）；脚本缺失时回退到“HUD 暂不可用”。
- 定时任务固定会话（`schedule-session-regression`，Claude 替身）：首次运行新开对话；第二次带 `--resume <上次会话 ID>`，替换上一次记录并保持同一标签；结束后会话可见且显示输出；“继续对话”以交互方式恢复同一对话并保留任务关联；会话开着时运行被跳过；结束对话后下一次运行再次续接。
- Codex `config.toml`：自定义连接重复启动后，信任目录与 hook 信任哈希保留，模型与供应商只有一份。

## 尚未验证

- 定时任务续接真实 Claude CLI 的 `-p --resume`（回归使用替身；Claude 在打印模式下续接后会话 ID 是否不变不影响续接，每次都以记录到的 ID 为准）。

- 在应用内新建 Claude 账号后首次会话的完整流程（逻辑由单测与脚本级验证覆盖）。
- 各 Agent 真实连接扫描到的 MCP 服务器（回归使用替身 CLI）。
- Windows CI 首轮 `windows-agent-prompt-smoke` 曾在测试退出时偶发超时（功能检查全部通过），重跑通过。
- `scripts/smoke.mjs` 在 1.2.1 上已因文件面板选择器不唯一而失败，本版未修复，CI 不运行该脚本。

安装包尚未签名/公证。
