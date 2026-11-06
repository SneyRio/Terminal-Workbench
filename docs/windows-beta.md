# Windows x64 内测

目标系统：Windows 10 22H2、Windows 11 x64。当前适配代码已完成，原生 Windows 验收和安装包发布仍待 GitHub Windows 工作流通过；不能把 macOS 单元测试当作 Windows 安装成功的证据。

## 安装与使用

验收通过后提供当前用户安装包 `WbSpace-0.4.0-windows-x64-setup.exe` 和可解压版本 `WbSpace-0.4.0-windows-x64-portable.zip`。可解压版仍在当前用户应用数据目录保存状态，不代表随 U 盘携带密钥。卸载默认保留用户数据。

本期未配置 Authenticode 证书。安装程序可能显示未知发布者，企业策略也可能禁止运行。仅使用本仓库 Release 的产物并核对 SHA256SUMS.txt。

先自行安装原生 Claude Code，选择 `%USERPROFILE%\.local\bin\claude.exe`，建议 CLI 不低于 2.1.318。暂不支持选择 npm `.cmd/.bat` shim 或 WSL 内部可执行文件。官方 OAuth 交由 Windows 的系统默认 URL 关联打开，不指定 Edge、Chrome 或内置浏览器。

内置终端默认 PowerShell；设置里可选 CMD。选中文字后 `Ctrl+C` 复制；`Ctrl+Shift+C` 始终用于复制；无选区的 `Ctrl+C` 发送给 CLI。文件使用 `Ctrl+S` 保存，快速打开遵循 Windows 文件类型关联。

新增官方账号自动建立独立配置目录，额外提供可在 PowerShell 复制使用的 `.cmd` 启动入口。应用内会话直接执行原生 CLI。自定义模型配置与 macOS 相同，供应商需兼容 Anthropic Messages 协议。

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

`.github/workflows/windows.yml` 在 Windows Server 2022 x64 runner 执行原生终端模块重建、单元测试、打包、隔离 GUI/ConPTY 测试，以及 NSIS 安装、启动、卸载和保留用户数据检查。安装卸载测试仅允许在可丢弃的 CI 环境执行。

集成测试使用编译后的 C# CLI 替身，检查真实 ConPTY、UTF-8 路径、事件钩子、PowerShell HUD、复制/中断、会话恢复、账号隔离和系统密钥加密持久性。测试不发模型请求、不进行真实 OAuth。即使 CI 通过，也不能宣称个人 Windows 10/11 桌面的真实 Claude 授权与全部 HUD 插件已验收。
