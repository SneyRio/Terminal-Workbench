# WbSpace 1.0.0 验收

本地 60 项单元测试与生产前端构建通过。macOS 打包应用通过 8 项发布回归（`release-readiness-regression-mac.json`）和 8 项一键更新端到端（`update-e2e-mac.json`，`scripts/update-e2e-mac.mjs`）。

端到端使用真实打包应用、真实下载校验流程和 `/Applications` 下的测试副本，只把 GitHub 响应替换成本地文件。覆盖：校验值被篡改时拒绝并可重试、未保存内容提示下取消不做改动、确认后替换并自动重启、草稿保留、升级快照、临时文件清理、替换后无隔离标记。

另外单独验证了由 LaunchServices 启动（父进程 launchd）的副本：一键更新成功替换并重启，未产生 App 管理权限拦截。这一项只代表开发机。

## API 协议与 Agent

`scripts/agent-route-check.mjs` 用真实 CLI 和应用生成的配置连接本地假服务，确认实际路径和认证头（`agent-route-check.json`）。Codex 明确拒绝 `wire_api="chat"`。Qoder 官方文档只允许用 `/model` 向导配置，未说明可自定义地址，因此不接自定义模型，改用官方账号登录。真实 `qodercli login` 在隔离目录中可进入等待浏览器授权，真实 `status -o json` 的已登录和未登录格式已核对；完整浏览器授权流程未自动验证。

`scripts/agent-protocol-regression.mjs` 在打包应用中验证协议映射、扫描、下载确认和会话启动（`agent-protocol-regression-mac.json`），会话启动使用替身 CLI。

## 官方账号登录

`scripts/agent-official-regression.mjs` 用替身 CLI 验证 Codex、OpenCode 的登录命令、独立目录、清除继承凭证、状态识别和启动（`agent-official-regression-mac.json`），也验证遗留的 Gemini CLI 账号不会影响应用且可以移除。真实 CLI 核对了 `codex login status` 的退出码和文字，以及 `opencode auth login` 进入选择供应商。完整的浏览器授权未自动验证。

不支持 Gemini CLI：实际用个人 Google 账号登录时，授权成功后服务端拒绝（`This client is no longer supported for Gemini Code Assist for individuals`）。Gemini 协议也一并去除。

## 官方账号用量

Codex 用真实 `codex app-server` 的 `account/rateLimits/read` 核对过 5 小时和每周窗口；Qoder 用真实 CLI 核对过状态栏的 `credits`，额度用尽的账号 `total_usage_percentage` 可能为 0，因此以 `is_quota_exceeded` 为准；OpenCode 的 `stats` 只有本地累计，不是订阅额度。

## 钥匙串授权

重新签名后首次读写加密密钥时，主进程会等待 macOS 钥匙串授权，表现为操作无响应，直到用户响应系统弹窗。已用系统 `SecurityAgent` 的运行时长确认。协议回归使用 `--use-mock-keychain` 避开它。

## 尚未验证

- 真实 GitHub 下载：要等 1.0.0 发布后，由下一个版本第一次走完整链路。
- Windows：更新脚本已加入 `windows-installer-smoke.mjs`，尚未运行，结果以 CI 为准。
- macOS CI 构建任务（`macos-14`）尚未运行。
- 真实供应商的完整对话：路由检查只确认请求发到正确地址，假服务不返回模型内容。
- 真实下载安装：单元测试和确认弹窗已覆盖，本机五个 CLI 均已安装，未实际执行安装命令。
- Windows 上启动 Claude Code 以外的 Agent。
- 其他 Mac 上的 App 管理策略：若替换被拒绝，会恢复旧版并提示手动安装。

## 测试注意

测试副本必须使用独立 Bundle ID。与正式版同 ID 的副本会被 LaunchServices 当作 WbSpace 打开，并读写真实数据目录。

安装包尚未签名/公证。
