# WbSpace 1.4.1 验收

124 项单元测试、类型检查与生产前端构建通过；`quit-keeps-sessions-regression`、新增的 `chat-interrupt-regression` 通过。

## 退出或更新后会话消失

- 现象：1.4.0 自动更新后，本机数据中更新前在运行的两个 Claude 会话状态为 `exited`，`lastEvent` 为 `SessionEnd`，两者的 `SessionEnd` 几乎同时写入（即更新退出时）。
- 原因：CLI 被结束时通过钩子上报 `SessionEnd`，遥测轮询据此记为 `exited`，1.3.2 的“退出时记为已中断”只在状态不是 `exited` 时生效；另外退出只等进程结束，不等状态写入，结果取决于时序。
- `quit-keeps-sessions-regression` 的替身 CLI 现在像真实 CLI 一样上报 `SessionStart`，并在收到信号时上报 `SessionEnd`。只保留“等待写入”、撤掉 `SessionEnd` 处理时测试失败（`Expected: not "exited"`），完整修复连续 3 次通过。

## 对话界面打断

- 真实 Claude CLI：发送 `interrupt` 控制请求后，CLI 返回 `result`（`error_during_execution`），对话流会正确回到空闲；被打断的轮次不触发 `Stop` 钩子。
- `chat-interrupt-regression`：替身 stream-json CLI 在消息发出 1 秒后才上报 `UserPromptSubmit`；发送后立即在输入框之外按 Esc，“中断”按钮消失，4.5 秒后会话仍为空闲。分别撤掉后端修复或前端 Esc 改动，测试均失败。

## 深色代码块

用构建后的样式与 highlight.js 渲染同一段 bash 并截图对比：修复前普通命令文本几乎不可见，修复后全部清晰。

## 尚未验证

- 未用真实 Claude 账号在应用内重放一次“更新后恢复会话”；依据为本机数据、代码路径与替身 CLI 回归。
- Windows 上未运行新增的两个回归脚本，CI 不运行它们。

安装包尚未签名/公证。
