Windows x64 内测包，提供当前用户安装程序和可解压 ZIP，保留既有 macOS 版本。

- 内置 PowerShell/CMD 终端、Windows 复制快捷键和文件默认应用关联。
- 官方多账号隔离，自定义供应商与模型；密钥通过当前 Windows 用户安全存储加密。
- 工作空间、文件预览编辑、会话恢复与最近删除。
- Windows Server 2022 x64 CI 验证：原生 ConPTY、Unicode/空格路径、钩子/HUD、复制与中断、账号密钥重启、安装启动卸载。验收报告随包提供。

下载后先核对 SHA256SUMS.txt。此包未做 Authenticode 签名，可能出现未知发布者提示；企业设备策略可能禁止运行。

需自行安装原生 Claude Code（建议最新版本，不低于 2.1.318），选择 claude.exe；不直接执行 npm .cmd shim 或 WSL 内部 CLI。真实官方 OAuth、模型请求和个人 Windows 10/11 桌面尚未由自动化替身测试覆盖。登录由系统默认浏览器处理。

卸载默认保留用户数据。Mac 钥匙串密钥不能复制到 Windows；跨系统迁移需重新认证。首次安装及完整边界见包内安装说明与 docs/windows-beta.md。
