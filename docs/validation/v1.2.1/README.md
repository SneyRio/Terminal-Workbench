# WbSpace 1.2.1 验收

99 项单元测试、类型检查与生产前端构建通过；`agent-official-regression`、`schedule-regression`、`agent-protocol-regression`、`release-readiness-regression` 通过。

- Claude Code：本地 429 假服务器上，Claude 2.1.319 只触发 `StopFailure`（`error: "rate_limit"`），不触发 `Stop`。应用内真实 Claude 会话：等待输入 → 工作中 → 等待输入。
- Codex 0.167.0：`codex app-server` 的 `hooks/list` 返回 hook 的键和哈希，与按源码规则复算的哈希一致；信任写入 `config.toml` 后 `SessionStart`、`UserPromptSubmit`、`Stop` 触发（通过 `-c` 传入的信任在该版本被忽略）。应用内真实 Codex 会话连本地 Responses 假服务器：工作中 → 等待输入。429 时没有任何结束事件。
- OpenCode 1.19.3：插件收到 `session.status`（busy / retry / idle）与 `session.idle`；429 重试耗尽后回到 idle。应用内真实 OpenCode 会话连本地 Chat Completions 假服务器：等待输入 → 工作中 → 等待输入。
- Qoder 1.1.85：用已登录账号在临时目录启动，`--settings` 中的 hook 触发了 `SessionStart`、`UserPromptSubmit`，载荷与 Claude 相同。该账号 Credits 已用尽，消息在请求前失败，`Stop` 与 `StopFailure` 都没有触发，由静默兜底处理。
- 静默兜底：应用内真实 Claude 会话等待慢速服务器时，20 秒内保持“工作中”（界面持续刷新）；按 Esc 打断后约 16 秒转为等待输入。

## 尚未验证

- Qoder 正常回复结束时的 `Stop`（需要可用 Credits）。
- Windows 上 Codex、Qoder 的 hook 与 OpenCode 插件（CI 的替身 CLI 不响应 `hooks/list`，只验证跳过 hook 后正常启动）。

安装包尚未签名/公证。
