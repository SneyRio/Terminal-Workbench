WbSpace 正式版。**安装包尚未签名/公证**：macOS 只有临时签名，Windows 没有 Authenticode，首次打开可能被系统拦截，请核对 SHA256SUMS.txt。

- 新增一键更新：设置 → 检查更新 → 下载并更新 → 重启并更新。0.4.x 及更早版本需手动安装一次本版本。
- 自定义供应商支持选择 API 协议（Anthropic Messages、OpenAI Chat Completions、OpenAI Responses），Agent 工具按协议自动匹配；新增 Codex CLI、OpenCode 启动，Codex、OpenCode、Qoder 官方账号登录，以及四个 Agent 的手动扫描和下载。新建会话可按 Agent 选择账号，默认使用工作空间设置。官方账号卡片显示用量：Codex 额度、Qoder Credits、OpenCode 本地累计。
- macOS Apple Silicon：DMG、ZIP；Windows x64：当前用户安装程序、可解压 ZIP。

- 自动扫描原生安装、npm 原生依赖、WinGet、Scoop 等常见位置，运行检查通过后接入；自动绕过失效 npm 启动脚本，无需手动查找路径。
- 内置 PowerShell/CMD 终端、Windows 复制快捷键和文件默认应用关联。
- 官方多账号隔离，自定义供应商与模型；密钥通过当前 Windows 用户安全存储加密。
- 工作空间、文件预览编辑与系统回收站删除、会话恢复与最近删除。
- Windows Server 2022 x64 CI 验证：原生 ConPTY、Unicode/空格路径、钩子/HUD、复制与中断、账号密钥重启、安装启动卸载。验收报告随包提供。

下载后先核对 SHA256SUMS.txt。macOS 首次打开需在隐私与安全性中确认“仍要打开”；Windows 可能出现未知发布者提示；企业设备策略可能禁止运行。

需自行安装 Claude Code（建议最新版本，不低于 2.1.318）。应用自动查找实际可执行程序；确实缺失时提供官方安装指引，安装后重新检测即可。仅高级设置保留手动路径，不直接执行 npm .cmd shim 或 WSL 内部 CLI。真实官方 OAuth、模型请求和个人 Windows 10/11 桌面尚未由自动化替身测试覆盖。登录由系统默认浏览器处理。

卸载默认保留用户数据。Mac 钥匙串密钥不能复制到 Windows；跨系统迁移需重新认证。首次安装及完整边界见包内安装说明与 docs/windows.md 和 docs/install.md。
