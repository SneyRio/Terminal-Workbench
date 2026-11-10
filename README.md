# WbSpace

以本地工作空间和内置终端为中心的 macOS / Windows 桌面应用，管理 Agent CLI 的账号、会话、用量与项目文件。

当前版本 **1.3.1 正式版（安装包尚未签名/公证）** 接入 Claude Code，支持自动隔离的官方订阅账号，以及自定义供应商、密钥和模型配置。自定义供应商还可通过 Codex CLI、OpenCode 启动，由所选 API 协议决定可用的 Agent。

![账号与连接](docs/screenshots/account-cards-dark.png)

截图使用隔离演示数据，额度不是用户实时余额。

## 安装

[Windows x64 安装版](https://github.com/SneyRio/Terminal-Workbench/releases/download/v1.3.1/WbSpace-1.3.1-windows-x64-setup.exe) · [Windows x64 ZIP 解压版](https://github.com/SneyRio/Terminal-Workbench/releases/download/v1.3.1/WbSpace-1.3.1-windows-x64-portable.zip) · [macOS Apple Silicon DMG](https://github.com/SneyRio/Terminal-Workbench/releases/download/v1.3.1/WbSpace-1.3.1-mac-arm64-unsigned.dmg)

[Release、校验值及安装说明](https://github.com/SneyRio/Terminal-Workbench/releases/tag/v1.3.1)

这是正式版，但安装包尚未签名/公证：macOS 只有临时签名，没有 Developer ID 和 Apple 公证；Windows 没有 Authenticode 证书。首次打开可能被系统拦截。macOS 需在系统设置的隐私与安全性中确认“仍要打开”，Windows 可能提示未知发布者，受管电脑可能禁止放行。请只从本仓库 Release 下载并核对 SHA256SUMS.txt。

**一键更新**：设置 → 检查更新 → 下载并更新 → 重启并更新。下载期间不影响会话，安装包通过 SHA-256 校验后才可安装，只有点击重启时才退出应用，配置和会话保留。Windows 解压版和从磁盘映像直接运行的副本无法替换自身，会转到下载页。默认走系统代理；下载慢时可在设置里填写“更新代理”（如 `http://127.0.0.1:7897`），它只用于检查和下载更新。0.4.x 及更早版本需手动安装一次 1.3.1，之后才能一键更新。

用户需自行安装 Claude CLI；应用自动检测，无需填写程序路径。Windows 支持原生安装、npm 原生依赖、WinGet、Scoop 等常见位置，并校验程序可运行；旧 npm 脚本失效时自动寻找其他安装。确实缺失时提供安装指引，安装后重新检测即可。再添加账号与工作空间。详见 [安装、升级及本机恢复说明](docs/install.md)。项目源码推送不代表 GitHub Release 已发布。

## 主要功能

- **无工作空间会话**：侧边栏顶部固定入口，会话在 `~/wbspace` 中启动（首次启动自动创建），可单独设置默认 Agent 和账号，不能移除或改目录。
- **工作空间**：多个有序本地项目，第一个项目根目录是 CLI 工作目录。左右导航可折叠，工作空间固定按创建时间倒序排列。
- **内置终端**：真实 PTY、多标签和分屏、搜索、复制、滚动、字体与行高设置；左侧与中间标签以边框跑马灯提示实际工作状态，遵循减少动态效果设置。工作状态来自各 Agent 自己的事件：Claude Code 与 Qoder 用 hook（含额度用尽等 API 错误结束时的 `StopFailure`），Codex 用 hook（应用在该账号配置中登记信任，与在 Codex 界面里批准相同），OpenCode 用插件；结束时没有事件（如按 Esc 打断、请求前就失败）的情况，终端 15 秒无输出即视为等待输入。Codex 新会话在发出第一条消息前显示“进程运行中”。仅支持内置终端，已移除外部终端联动。
- **账号卡片**：搜索、工具筛选、身份与认证状态、五小时及周剩余额度、重置倒计时、连接详情和快捷新建会话。
- **连接管理**：引用本机已配置的启动入口、自动生成官方独立账号目录和启动命令，或添加自定义供应商与多个模型。自定义模型不套用订阅额度条，底部状态栏与内置 HUD 回退也不显示订阅额度占位。
- **会话连续性**：精确会话 ID 恢复、检查点和明确标识的上下文交接；会话可切换到任意 Agent 的任意账号继续（Claude 之间可原生恢复，其余通过交接资料）。目标就绪后移除旧入口，失败保留原记录。
- **自动标题**：从首条有效任务摘取短标题，不额外调用模型；手动命名优先，恢复及切换保留标题。会话显示为 `[agent]标题`（悬停提示里同样不含账号名，账号见底部状态栏），鼠标停留可看完整名称。
- **定时任务**：按间隔、每天、每周或 cron 表达式，用指定账号在工作空间里无人值守地运行提示词，每个任务在工作空间里固定一个会话：Claude 任务每次运行用 `--resume` 接着上一次的对话（换账号、换目录或使用独立工作树时新开），运行结束后会话保留，可查看输出并点“继续对话”交互接着聊；会话开着时到点的运行会跳过。每次运行都有运行记录。权限分只读（默认，在项目目录运行）、可修改项目文件、完全权限；后两者默认在独立 Git 工作树和 `wbspace/` 新分支中运行，不影响当前工作区。上一次未结束不重复运行，有超时，额度接近用尽时跳过，结果发系统通知。仅在应用运行时执行，错过的可在启动后补跑一次。
- **系统提示词**：在“设置 → 系统提示词”中添加多条自定义提示词，可单独启用、排序，并选择对哪些 Agent 生效。内容追加在各 Agent 自带的系统提示词之后，不替换原有内容：Claude Code 用 `--append-system-prompt-file`，Codex CLI 用 `-c developer_instructions`（Windows 上遇到认不出的 `.cmd` 启动脚本时，改为写入该账号 `CODEX_HOME` 下带标记的 `AGENTS.md`），Qoder CLI 用 `--append-system-prompt=`，OpenCode 用配置项 `instructions`。保存后对新开、恢复和定时任务的会话生效。
- **MCP 与 CLI**：左侧“MCP 与 CLI”页统一管理，所有 Agent 共用。MCP 服务器在启动时自动扫描并接入 Claude（`~/.claude.json` 及 `~/.claude-*` 配置目录）、Qoder（`~/.qoder/mcp.json`）、OpenCode（`~/.config/opencode/opencode.json`）和 Codex（`codex mcp list`）已有的配置，同名只取一个，删除过的不再接入；Codex 自带的应用工具依赖 Codex 自身环境，不会接入。环境变量与请求头加密保存在本机，`${VAR}` 引用在启动时从应用和登录 Shell 的环境展开。会话启动时按各 Agent 的方式注入，不改动它们自己的配置：Claude Code 与 Qoder 用 `--mcp-config` 临时文件，Codex 用 `-c mcp_servers.*`，OpenCode 用 `OPENCODE_CONFIG_CONTENT`。命令行工具可扫描常见工具或手动添加，启用后其目录加入会话 PATH，并以“本机已安装以下命令行工具”附加到系统提示词。
- **Claude 状态栏**：账号目录有自己的 `statusLine` 时照常使用；没有时沿用默认 `~/.claude/settings.json` 的状态栏（HUD 以 `~/.claude` 作为配置目录查找插件）；两处都没有时显示随 WbSpace 内置的 [claude-hud](https://github.com/jarrodwatts/claude-hud)（MIT），用 WbSpace 自带运行时执行，默认中文，可在账号目录的 `claude-hud.json` 修改。更新内置版本：`node scripts/vendor-claude-hud.mjs [插件目录]`。
- **最近删除**：按工作空间分组保留手动删除的会话 7 天，支持恢复和永久删除。自动替换不进入回收清单。
- **文件与 Git**：多项目文件树着色、文本编辑、Markdown/JSON/CSV/图片预览、冲突保护、上下拖动和内容放大、图形化 Git 差异，Git 面板可切换本地和远程分支（工作区有变更或有会话运行时先确认，冲突时拒绝且不改动），可逐个或按组暂存、提交暂存区，推送（无上游时设到 origin）和仅快进的拉取（分叉时拒绝，需在终端处理），认证使用本机 Git 凭据，底部状态栏显示当前会话所在分支；文件与文件夹可确认后移入系统回收站，保护未保存内容与项目根目录。
- **外观**：浅灰、黑夜、跟随系统、本地背景图片及透明度，内置 JetBrains Mono 字体。

## 运行环境

macOS Apple Silicon，或 Windows x64；开发需要 Node.js 22.12+、对应平台的 C++ 编译工具和自行安装的 Claude Code。Windows 原生 CI 构建、桌面与安装卸载验收已通过，发布状态见 [Windows 说明](docs/windows.md)。Linux 尚未适配。

```sh
npm ci
npm run dev
```

构建与运行：

```sh
npm run build
npm start
```

生成 macOS 应用包：

```sh
npm run package:mac
```

产物位于 `release/builds.noindex/WbSpace-darwin-arm64/WbSpace.app`。安装包尚未签名/公证（无 Apple Developer ID）。

如果 Electron 尚未下载或原生终端模块需要重建：

```sh
node node_modules/electron/install.js
npm run rebuild:native
```

## 开始使用

1. 打开“账号与连接”，添加连接。可选本机入口、独立官方配置、自定义供应商。官方账号自动生成独立目录和可复制的启动命令；点击“创建并登录”进入官方 CLI 授权。
2. 创建工作空间并选择本地项目，第一个项目作为主目录；为该工作空间选择默认 Agent 工具和默认账号。
3. 从工作空间新建 CLI / Shell：“新建会话”使用工作空间默认值，下拉菜单可按 Agent 选择其他账号，不改变默认值；也可从账号卡片选择工作空间后启动指定账号的会话。卡片启动不会改写其他会话或工作空间默认身份。
4. 从卡片的更多菜单查看详情、重命名、检查状态、切换当前会话账号或移除连接。移除 WbSpace 创建的账号会退出登录并永久删除其本地目录（凭证、加密密钥、该账号的 CLI 会话历史），引用的本机已有配置不受影响。模型服务页可新增和编辑自建连接的供应商名称、Anthropic 兼容地址、认证方式、密钥、模型列表与默认模型；原有脚本引用继续由原配置管理。
5. 在右侧编辑和预览文件。`Cmd+S` 保存，`Cmd+Shift+S` 保存文件区全部修改；文件快速打开遵循系统按文件类型的默认关联。

网页登录始终交给系统默认浏览器；不会选择特定浏览器或使用内置网页登录。

自定义供应商需选择 API 协议，Agent 工具按协议过滤，不做协议转换：

| API 协议 | 可选 Agent |
|---|---|
| Anthropic Messages（`/v1/messages`） | Claude Code、OpenCode |
| OpenAI Chat Completions（`/chat/completions`） | OpenCode |
| OpenAI Responses（`/responses`） | Codex CLI、OpenCode |

Codex、OpenCode、Qoder 也可在“独立官方配置”用官方账号登录（Qoder 只支持这种方式）：每个账号有独立配置目录，互不影响，也不影响 `~/.codex`、`~/.qoder` 等已有登录。Codex 使用 ChatGPT 账号，OpenCode 由你在其登录界面选择要连接的供应商账号。不支持 Gemini CLI：Google 已于 2026-06-18 停止个人、AI Pro 和 Ultra 账号使用它。这些 Agent 只在内置终端启动：恢复时开启新进程，附加项目不会传入。

官方账号的用量：Codex 显示 5 小时和每周额度（来自官方 app-server，不发模型请求）；Qoder 显示 Credits 剩余（来自状态栏数据，开始一次会话后更新）；OpenCode 没有订阅额度接口，只显示 `opencode stats` 的本地累计费用和 Token。

密钥经 Electron safeStorage 使用系统安全存储加密后保存为本机加密文件（macOS 权限 0600），不进入普通状态或项目配置。编辑时密钥留空表示保留，修改在新启动/恢复的会话生效；检查配置只确认本地可用性，不发送推理请求。不同自定义服务间切换默认使用可预览的上下文交接。官方独立启动命令位于应用数据目录的 `bin/`，可在详情中复制完整路径；不会覆盖 `~/.local/bin` 的已有入口。

## 数据与恢复边界

认证由原 CLI 配置管理。引用已有入口不复制凭证，不改写原包装脚本或用户级 HUD。用量来自实际可用来源；“检查连接状态”不代表闲置账号额度已刷新，也不会通过模型请求探测余额。

新安装的数据目录为 macOS `~/Library/Application Support/WbSpace`，Windows `%APPDATA%\WbSpace`。从旧版 Claude Accountor 升级时继续使用旧数据目录，保留工作空间、账号引用、草稿和恢复资料。更名安装不会强行结束旧版进程；请先退出旧应用，再打开 WbSpace。

永久删除清除本工具的恢复记录和未被其他记录引用的专用检查点，不能再从本工具恢复；项目文件与原始 CLI 历史不会删除。Shell 恢复会创建同目录的新进程，不会复活已结束的命令。

原生会话恢复与可预览的上下文交接是两种不同方式。工具运行状态、后台进程和不同 Agent 的内部状态不能承诺完整迁移。跨 Agent 接力：读取源 Agent 的会话记录（Claude、Qoder 的 jsonl，Codex 的 rollout 记录，OpenCode 的 `export`），生成可编辑的交接资料；目标是 Claude 时作为附加系统提示，其他 Agent 以开场提示要求先阅读资料再等待指示。切换会结束源 CLI 进程，正在执行的任务会被中断。

## 验证与文档

```sh
npm test
npm run test:e2e
```

纯单元测试使用临时目录。桌面集成测试需要可运行的 macOS GUI；真实 CLI 恢复、已有账号检查等专项依赖本机配置的专用测试入口和测试会话，不是通用 CI 的前置条件。终端选区在深色、浅色和失焦时保持高对比，括号与中文拖选后可精确复制。

集成脚本可通过 `ACCOUNTOR_EXECUTABLE` 指向打包后的可执行文件，测试数据使用隔离目录。

- [新版 PRD 与选定方案](docs/prd/terminal-workbench-prd-v1.md)
- [实现和测试记录](docs/implementation-report.md)
- [视觉验收](design-qa.md)

新版本启动前会生成本机配置与加密密钥快照，保留最近五份；设置中可备份、查看备份和一键更新。重复启动激活已有实例。更新只由用户点击触发，不后台安装。

项目不会提交本机账号状态、凭证、测试数据、`node_modules` 或安装包。字体原始文件和 SIL OFL 1.1 许可证随源码及应用分发，见 [字体来源与许可](public/licenses/jetbrains-mono/source.json)。
