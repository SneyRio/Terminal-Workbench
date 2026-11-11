# WbSpace 1.4.4 验收

136 项单元测试（新增 `claude-usage` 3 项）、类型检查与生产前端构建通过。

## 刷新同时更新用量

- 真实 CLI 验证：订阅账号执行 `claude -p /usage --output-format json --no-session-persistence --strict-mcp-config --setting-sources ''` 约 1–4 秒返回，`result` 文本包含 `Current session` 与 `Current week (all models)` 两行；0 token，`modelUsage` 为空，不产生会话记录。
- 解析结果与真实输出一致：本机订阅账号解析出 100% / 88%，重置时间按输出里的时区换算正确。
- 回归 `account-cards-regression`：点击刷新后，替身 CLI 的 `/usage` 被以固定参数调用，卡片用量从 12%/85% 更新为 40%/70%，进度条同步变化；登录状态也同时刷新。
- 无法拉取用量的连接（自定义供应商、OpenCode、Qoder）不再显示"用量已更新"，分别提示连接有效或暂未取到用量。

## 对话界面下拉

- 权限模式与模型改为自绘列表，支持方向键、Home/End、Enter、Esc、点击外部关闭；Esc 只关闭列表。
- 用替身 CLI 实跑自定义账号会话截图确认：初始显示连接的默认模型 `model-b`，展开只列出 `model-a`、`model-b`，选中后按钮变为 `model-a`；权限列表为「自动 / 计划 / YOLO」。
- 订阅账号仍使用原模型列表；`chat-interrupt-regression`、`chat-native-smoke` 的断言已改为新的下拉结构。

## 回归

`account-cards`、`account-login`、`connection-provisioning`、`chat-interrupt` 全部通过。同时补上两个替身 CLI 的 `--version` 响应：缺失时会话启动会等待版本检查超时 15 秒，导致新建会话在 5 秒断言内失败（改动前即存在）。

## 环境说明

在本应用内置终端里直接运行 `node --test` 时，应用注入的 `ACCOUNTOR_ACCOUNT_PROVIDER=custom` 会让 2 项状态栏用例按自定义供应商分支执行而失败；清除该变量后 136 项全部通过，与本次改动无关。

## 尚未验证

- 未在打包后的应用里用真实账号点按刷新；依据为真实 `/usage` 输出与替身 CLI 回归。
- Windows 未运行该回归脚本，CI 不运行它。
- 未验证自定义连接的模型切换在真实网关上生效；依据为既有的 `set_model` 控制消息路径。

安装包尚未签名/公证。
