# WbSpace 1.3.0 验收

109 项单元测试、类型检查与生产前端构建通过；`agent-official-regression`、`schedule-regression`、`agent-protocol-regression`、`quota-footer-regression` 通过。打包后的 `release-readiness-regression` 与 Windows 冒烟（含 MCP、CLI 工具传入 Codex / Qoder / OpenCode 的断言）由 CI 执行。

- 状态栏继承：账号目录为空时，读取 `~/.claude/settings.json` 中的 claude-hud 命令，并以 `~/.claude` 为配置目录运行，本机真实 claude-hud 正常输出。
- 内置 claude-hud 0.10.0：经 Electron（`ELECTRON_RUN_AS_NODE`）由遥测脚本调起，在空账号目录中输出中文 HUD（上下文、用量）；脚本缺失时回退到“HUD 暂不可用”。
- Codex `config.toml`：自定义连接重复启动后，信任目录与 hook 信任哈希保留，模型与供应商只有一份。

## 尚未验证

- 在应用内新建 Claude 账号后首次会话的完整流程（逻辑由单测与脚本级验证覆盖）。
- 各 Agent 真实连接扫描到的 MCP 服务器（回归使用替身 CLI）。
- `scripts/smoke.mjs` 在 1.2.1 上已因文件面板选择器不唯一而失败，本版未修复，CI 不运行该脚本。

安装包尚未签名/公证。
