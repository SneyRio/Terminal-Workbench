# WbSpace 1.4.2 安装与升级

当前包适用于 macOS Apple Silicon（M 系列），Electron 声明最低 macOS 13；本轮只在当前开发机验收，未在另一台真实 Mac 或 Intel Mac 验收。包具有完整临时签名，没有 Developer ID 发行身份，也没有 Apple 公证。这是正式版，但安装包尚未签名/公证，不承诺通过 Gatekeeper 默认检查。

Windows x64 安装见 [Windows 说明](windows.md)。本文为 macOS 指南。

## 安装

下载入口：[GitHub Release](https://github.com/SneyRio/Terminal-Workbench/releases/tag/v1.4.2)，提供 DMG、ZIP、SHA256SUMS.txt 和独立安装说明。

1. 获取 `WbSpace-1.4.2-mac-arm64-unsigned.dmg`，可用 `SHA256SUMS.txt` 核对哈希。
2. 打开 DMG，将“WbSpace.app”拖到 Applications。旧版需先等任务结束，再按 ⌘Q 退出后替换。
3. 弹出磁盘映像，从“应用程序”打开。
4. 如果出现未验证开发者/未公证拦截，先尝试打开一次，再到“系统设置 → 隐私与安全性 → 仍要打开”确认。公司受管设备可能不允许手动放行。不要关闭整机安全检查；若提示恶意软件或签名/文件损坏，应停止并检查来源及校验值。
5. 跟随首次启动指南检查 Claude CLI、添加自己的账号和创建工作空间。应用内置终端运行环境，但 Claude CLI 仍需独立安装。指南可选择 CLI 可执行文件，或打开官方安装说明，不静默运行下载安装脚本。

安装包不包含开发者的账号、密钥、项目、会话或 GitHub 凭据。用户无需安装本项目的 Node 开发依赖或 Xcode。官方账号在系统默认浏览器中授权；自定义连接使用用户自己的服务地址和密钥。

## 已有配置导入

“账号与连接 → 添加连接 → 本机现有入口”扫描当前用户的 `.claude`、`.claude-*` 和 `.claude_*` 目录，也可通过系统选择框选任意配置目录。列表仅返回目录和推断类型，不向界面返回 settings 中的密钥。自动识别不能代表实际认证成功；用户可明确选择官方订阅或自定义模型。

导入只引用目录，不复制凭证，也不修改原配置。原包装脚本专有的环境变量不自动解析或复制；如果参数只写在脚本中，请使用新增自定义供应商表单建立托管连接。旧版四个启动入口继续作为历史兼容读取，已不作为新用户发现的白名单。

## 更新与本机恢复

设置 → 检查更新查询 GitHub 最新正式 Release；发现新版后点击“下载并更新”，再点击“重启并更新”。全程由用户触发，不后台下载或安装；检查和下载不停止 CLI。下载地址固定为本仓库，安装包必须与 Release 内 SHA256SUMS.txt 一致，并通过应用标识、版本和代码签名结构检查。默认走系统代理，也可在设置中填写只用于更新的代理。校验保证文件完整且来自本仓库 Release；由于没有发行者签名，不能证明发行者身份。

点击重启后，如有运行中的终端或未保存草稿会先询问，选择取消则不做任何改动。应用退出后由独立脚本替换应用包并重启；替换失败时恢复旧版并在下次启动提示，可重试或从下载页手动安装。若应用从磁盘映像运行、被系统随机化路径或所在目录不可写，会改为打开下载页。更新后首次读取自定义供应商密钥时，macOS 可能请求钥匙串授权，选择“始终允许”即可，因为每次临时签名的应用身份都不同。其他 Mac 若启用了更严格的 App 管理策略，替换可能被拒绝，此时按提示手动安装。0.4.x 及更早版本需手动安装一次 1.4.2。

应用以当前数据目录获取单实例锁，重复启动激活已有窗口，避免多个进程同时写状态。启动新版本时先备份旧 `state.json` 与应用管理的加密密钥，再加载和迁移；状态损坏、未知未来结构或备份失败时停止升级，不覆盖原数据。保留最近五份本机快照，也可在设置中手动备份和打开备份目录。

备份在应用数据目录的 `backups.noindex/upgrade-*`。恢复前必须退出应用并保留当前数据副本，再用快照 `state.json` 替换原文件；加密凭据按快照的 accounts 相对目录补回。项目文件和 CLI 原始历史未因快照而复制、移动或删除，不能把此快照当作完整项目备份。密钥依赖此 Mac 用户的钥匙串，不能靠复制备份在另一台电脑恢复认证。需要协助时先保留现场，不把包含会话的 state 或密钥备份上传公共仓库。

## 构建与未来签名

```sh
npm ci
npm run release:mac
```

发布脚本生成 DMG、ZIP、安装说明、SHA-256 和 JSON 清单。每次验证临时/发行签名资源封装与 DMG 结构。运行时和已打入前端的依赖许可汇总至应用 `dist/licenses/`；Electron/Chromium 许可随运行时分发。字体 OFL 保留。

如需签名/公证，需先取得 Apple Developer Program 会员和本机 Developer ID Application 证书。公证认证先通过 `xcrun notarytool store-credentials` 存入钥匙串。构建时设置 `TW_SIGN_IDENTITY` 为证书身份、`TW_NOTARY_PROFILE` 为钥匙串中的公证凭据名、`TW_REQUIRE_SIGNING=1` 再执行发布流程。身份只接受 Developer ID Application；缺少配置时失败，不悄悄降级成未签名包。未实际执行过正式签名/公证流程，需证书可用后单独验收。

此流程会签名应用，提交应用公证，签名 DMG 并提交公证，再 stapler 验证；未获 Accepted 的包不作为公证包交付。证书私钥、账号密码和 API 私钥不得写入源码或日志。保持现有 bundle ID 和数据目录兼容；从临时签名切换到正式身份后，要再次验证钥匙串提示与已有密钥解密。后台静默更新依赖稳定签名身份，当前未启用。

参考：[Apple 首次打开说明](https://support.apple.com/en-mo/102445)、[Developer ID 证书](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)、[Electron 签名](https://www.electronjs.org/docs/latest/tutorial/code-signing)。

历史用户继续使用原数据目录、bundle ID 和加密命名空间，公共显示名统一为 WbSpace。旧应用仍在运行时不强制退出或移动其资源；首次启动 WbSpace 会要求先退出旧应用，避免写入同一份旧状态。CLI 从应用启动时禁用 Chrome 扩展集成；系统默认浏览器授权行为保留。
