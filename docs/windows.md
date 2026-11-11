# Windows x64

目标系统：Windows 10 22H2、Windows 11 x64。Windows Server 2022 x64 原生构建、单元检查、17 项桌面流程及 5 项安装生命周期检查（含一键更新脚本）已通过，每次发布由 CI 重新验收。安装包发布见 [1.4.0 Release](https://github.com/SneyRio/Terminal-Workbench/releases/tag/v1.4.0)；个人 Windows 10/11 桌面和真实 OAuth 仍需用户环境验收。

## 安装与使用

提供当前用户安装包 `WbSpace-1.4.0-windows-x64-setup.exe` 和可解压版本 `WbSpace-1.4.0-windows-x64-portable.zip`。可解压版仍在当前用户应用数据目录保存状态，不代表随 U 盘携带密钥。卸载默认保留用户数据。

这是正式版，但安装包尚未签名（未配置 Authenticode 证书）。安装程序可能显示未知发布者，企业策略也可能禁止运行。仅使用本仓库 Release 的产物并核对 SHA256SUMS.txt。

安装版在设置 → 检查更新中可一键更新：通过 SHA-256 校验后，点击“重启并更新”，应用退出并静默安装到原目录再重启，用户数据保留。解压版无法替换自身，会转到下载页。0.4.x 及更早版本需手动安装一次 1.4.0。

先自行安装 Claude Code，建议 CLI 不低于 2.1.318。应用自动扫描 PATH、注册表、原生安装、npm 原生依赖、WinGet、Scoop 等常见位置，运行校验通过后自动使用，无需知道安装路径。旧 npm `.ps1/.cmd` 脚本失效时会跳过；只有失效脚本且实际程序缺失时会明确提示修复安装。安装或修复后在“账号与连接 → Agent 工具”中点击 Claude Code 的“重新扫描”，再新建内置终端。手动路径放在 Agent 工具页 Claude Code 的“高级：指定 CLI 路径”。暂不支持直接运行 WSL 内部程序。官方 OAuth 交由 Windows 的系统默认 URL 关联打开，不指定 Edge、Chrome 或内置浏览器。

内置终端默认 PowerShell；设置里可选 CMD。选中文字后 `Ctrl+C` 复制；`Ctrl+Shift+C` 始终用于复制；无选区的 `Ctrl+C` 发送给 CLI。文件使用 `Ctrl+S` 保存，快速打开遵循 Windows 文件类型关联。

新增官方账号自动建立独立配置目录，额外提供可在 PowerShell 复制使用的 `.cmd` 启动入口。应用内会话直接执行原生 CLI。自定义模型配置与 macOS 相同，按所选 API 协议匹配 Agent。npm、pnpm、yarn 安装的 `.cmd` 入口（如 Codex、OpenCode）会读取脚本指向的实际程序直接启动（Node 脚本用 `node.exe` 运行），参数不经过 `cmd.exe`，因此系统提示词、定时任务和接力提示中的引号、`%`、`^`、`&`、换行都能原样传入。认不出的脚本仍经 `cmd.exe` 启动，此时含引号、`%`、`^` 或换行的参数会被拒绝；Codex 的系统提示词在这种情况下改写到该账号 `CODEX_HOME` 下带标记的 `AGENTS.md`。CI 用 npm 脚本替身验收这条路径；Claude Code 以外的 Agent 尚未在个人 Windows 桌面用真实账号验收。

新安装数据位于 `%APPDATA%\WbSpace`；新建官方账号、检查点和备份位于同一数据目录。自定义供应商密钥通过 Electron safeStorage 使用 Windows 当前用户的安全存储加密。macOS 钥匙串密文不能直接迁移；跨用户/跨系统恢复配置后需重新登录或填写密钥。账号和项目不会随应用打包。

## 开发与构建

使用原生 Windows x64、Node.js 22.12+、Visual Studio 2022 C++ Build Tools（含 Windows SDK 和 node-pty 所需组件），运行：

```powershell
npm ci
npm run package:win
node scripts/build-windows-fixture.ps1
npm run test:windows
node scripts/release-windows.mjs
```

`release/builds.noindex/WbSpace-win32-x64` 是未安装应用目录，`release/windows` 保存 NSIS、ZIP 和校验清单。构建脚本拒绝用 macOS 产物冒充原生 Windows 验证。

`.github/workflows/release.yml` 在 Windows Server 2022 x64 runner 执行原生终端模块重建、单元测试、打包、隔离 GUI/ConPTY 测试，以及 NSIS 安装、启动、一键更新脚本、卸载和保留用户数据检查。安装卸载测试仅允许在可丢弃的 CI 环境执行。

集成测试使用编译后的 C# CLI 替身，检查真实 ConPTY、UTF-8 路径、事件钩子、PowerShell HUD、复制/中断、会话恢复、账号隔离和系统密钥加密持久性。测试不发模型请求、不进行真实 OAuth。即使 CI 通过，也不能宣称个人 Windows 10/11 桌面的真实 Claude 授权与全部 HUD 插件已验收。
