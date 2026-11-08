# WbSpace 1.2.0 验收

92 项单元测试、类型检查与生产前端构建通过。

- 系统提示词（`tests/system-prompts.test.cjs`）：输入清理与上限、按 Agent 筛选和拼接、四种 Agent 的传入方式、Codex 的 `AGENTS.md` 回退不覆盖用户自己的文件。
- 本机 CLI 实测：Claude Code 2.1.319 接受 `--append-system-prompt-file`；Codex 0.166.0 的 `codex debug prompt-input` 显示 `-c developer_instructions` 以 developer 消息生效，`$CODEX_HOME/AGENTS.md` 回退也被读取；Qoder 1.1.85 接受 `--append-system-prompt=…`；OpenCode 1.19.3 的 `debug config` 读到绝对路径的 `instructions`。
- Windows 参数（`tests/platform.test.cjs`）：标准转义与参考解析器往返一致，Windows CI 上再用真实 Node 解析核对；npm、pnpm、yarn 的 `.cmd` 脚本解析，认不出的脚本回退到 `cmd.exe`。
- Windows 端到端（`scripts/windows-agent-prompt-smoke.mjs`，CI 运行）：npm 脚本替身的 Codex、Qoder 原样收到含引号、`%`、`^`、`&`、换行的系统提示词和定时任务提示词；认不出的 OpenCode 脚本经 `cmd.exe` 启动并读到提示词文件。同一流程已在 macOS 上用可执行脚本替身跑通。
- 退出：该端到端测试保留 4 个运行中的 Agent 会话直接退出应用。首轮 CI 中提示词检查全部通过，但退出时应用崩溃（0xC0000409）；改为先等终端进程结束再退出后重新验收。macOS 上同样带运行中会话退出，退出码 0。
- 设置页在隔离数据目录中验证了添加、勾选 Agent、保存和“至少选择一个 Agent”的提示。

## 尚未验证

- 用真实账号开对话，确认模型按提示词行事（会消耗额度）。
- 个人 Windows 10/11 桌面上真实安装的 Codex、Qoder、OpenCode。

安装包尚未签名/公证。
