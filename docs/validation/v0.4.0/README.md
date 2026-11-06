# WbSpace 0.4.0 验收

2026-11-06。macOS arm64 本机与 Windows Server 2022 x64 GitHub runner 分别验证。

- 本机 `npm test`：44 项通过。Windows 执行其中适用的 25 项子集，不重复相加为独立用例总数。
- Windows 打包应用：14 项桌面流程通过，涵盖真实 ConPTY、中文/空格路径、官方账号配置隔离、PowerShell HUD、复制/中断、文件保存及本地 Markdown 预览、系统回收站、恢复替换、DPAPI 密文重启、PowerShell/CMD、单实例。
- Windows NSIS：当前用户安装、安装后首次启动、无调试器时的原生窗口关闭（退出码 0）、卸载并保留用户数据，4 项通过。使用包含中文、空格、& 的安装路径。
- Windows 测试控制器使用系统进程句柄独立观察真实 GUI 进程退出码；测试启动器仅在 GUI 正常退出后清理。不会把启动器 PID 当成应用 PID。
- macOS 打包回归：文件删除 6 项、会话恢复与最近删除 13 项、基础工作空间/PTY/编辑与重启恢复 13 项通过。本轮还运行终端控件、账号配置和升级备份专项，报告同目录保存。
- 本机安装 `/Applications/WbSpace.app`，602 个文件逐一校验；旧包保留在本机备份目录，未结束用户正在运行的会话。
- macOS DMG 经完整资源封装签名验证和 `hdiutil verify` 校验，无 Developer ID 或 Apple 公证。Windows 无 Authenticode 签名。

[主分支构建、验收及发布运行](https://github.com/SneyRio/Terminal-Workbench/actions/runs/42180666657)

Windows CLI 生命周期使用编译后的 C# 替身，真实操作系统终端、剪贴板、加密和安装器均实际执行；不发送模型请求、不进行真实 OAuth。不能据此宣称已在每个 Windows 10/11 用户桌面或所有 HUD 插件中验收。macOS 文件删除专项用隔离目录模拟系统回收站，Windows 对可丢弃文件实际调用系统回收站。项目根目录和未保存内容受到删除保护，回收失败不会降级为永久删除。

发布状态：Windows exe / ZIP 已在 `v0.4.0-win-beta.16` 公开，匿名下载返回 200，服务器 SHA-256 与验收清单一致。macOS 0.4.0 DMG 已重传并公开发布，匿名下载返回 200，服务器 SHA-256 和独立校验文件均与本地一致。此前直连与 SOCKS 上传被远端以 body inactivity timeout 中止；本次使用 HTTP/1.1 并禁用 Expect 等待成功。详见 [macOS 发布校验](mac-release.json)。
