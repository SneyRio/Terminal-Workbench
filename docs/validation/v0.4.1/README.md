# WbSpace 0.4.1 自动检测验收

本地 50 项单元测试与生产前端构建通过。macOS 打包应用通过 8 项启动、配置、升级回归，资源签名及 DMG 校验通过。

[Windows 原生验收](https://github.com/SneyRio/Terminal-Workbench/actions/runs/42193825522)：31 项单元检查、17 项桌面/ConPTY 流程、4 项安装生命周期检查通过。

新增复现场景：环境 PATH 中只有失效 claude.ps1/claude.cmd，实际程序位于 npm 可选原生依赖目录；不设置手工路径，自动发现并校验程序。旧配置指向失效 .ps1 时自动回退；新开的 PowerShell 和 CMD 执行 claude --version 均成功，不执行失效脚本，不修改全局 PATH 或用户 PowerShell 配置。

单元检查还覆盖自定义 npm prefix、刷新后的注册表 PATH、WinGet 包目录、旧版本/不可启动程序跳过、缓存失效、凭据隔离和只有失效脚本时的明确错误状态。

Windows 使用 C# CLI 替身与真实 Windows Shell、ConPTY、系统安全存储及 NSIS，不发模型请求，也未执行真实 OAuth。个人 Windows 10/11 环境与截图所示机器上的实际安装仍需用户更新后验证。

当前安装包属于未公证/未发行者签名内测版本。
