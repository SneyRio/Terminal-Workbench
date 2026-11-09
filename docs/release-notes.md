WbSpace 1.3.0。**安装包尚未签名/公证**：macOS 只有临时签名，Windows 没有 Authenticode，首次打开可能被系统拦截，请核对 SHA256SUMS.txt。

- 新增“MCP 与 CLI”页，所有 Agent 共用：
  - 启动时自动扫描 Claude（`~/.claude.json` 与 `~/.claude-*`）、Qoder、OpenCode 和 Codex 已配置的 MCP 服务器并接入，也可以手动添加、编辑、按 Agent 启用。环境变量和请求头用系统安全存储加密保存。
  - 新会话启动时按各 Agent 的方式传入：Claude Code / Qoder 用 `--mcp-config`，Codex 用 `-c mcp_servers.*`，OpenCode 用配置环境变量。不改动各 Agent 自己的配置文件。
  - 扫描 PATH 中的常用命令行工具（gh、docker、kubectl、jq、rg 等），启用后加入会话的 PATH，并在系统提示词中告知 Agent。
- 新增 YOLO 模式：在“Agent 工具”中按 Agent 开启，新开的交互会话跳过所有权限确认（Claude / Qoder `--dangerously-skip-permissions`，Codex `--dangerously-bypass-approvals-and-sandbox`，OpenCode 权限全部允许）。定时任务仍按任务设置的权限运行。
- 内置 claude-hud 状态栏：
  - 新建的 Claude 账号不用再手动配置。账号目录没有自己的状态栏时，沿用默认 `~/.claude/settings.json` 的状态栏，HUD 在 `~/.claude` 下查找插件。
  - 两处都没有时，显示随应用内置的 [claude-hud](https://github.com/jarrodwatts/claude-hud) 0.10.0（MIT），用应用自带的运行时执行，默认中文。
- 文件树：悬停可复制名称，右键可复制名称、相对路径或完整路径。
- 修复：Codex 自定义连接每次启动都会覆盖 `config.toml`，丢失 Codex 记录的信任目录和 hook 信任。现在只替换 WbSpace 写入的模型与供应商配置。
- 修复：Codex 的 Interrupt hook 超时超过 Codex 上限（3 秒），导致界面出现警告。
- 1.0.x 至 1.2.1 可在设置中点击检查更新直接升级；0.4.x 及更早版本需手动安装一次本版本。

下载后先核对 SHA256SUMS.txt。macOS 首次打开需在隐私与安全性中确认“仍要打开”；Windows 可能出现未知发布者提示；企业设备策略可能禁止运行。
