# WbSpace 1.4.2 验收

126 项单元测试（`chat-engine` 新增 2 项）、类型检查与生产前端构建通过；`chat-interrupt-regression` 通过。

## 真实 Claude CLI 行为（stream-json）

- 工作中发送的消息由 CLI 排队，在当前工具完成后并入同一轮；当前工具结束前不会被处理。
- 排队后发送 `interrupt`：CLI 返回 `still_queued: []`，输出被打断轮次的 `result` 后立即以 `system init` 开始新一轮处理排队消息。
- `system init` 只在一轮开始时出现，启动后未发消息时不会出现。

## 回归

`chat-interrupt-regression` 的替身 CLI 按上述行为排队与打断，新增三个场景：

1. 工作中按 ⌘Enter 立即发送：当前轮被打断，消息随即得到回复。
2. 工作中按 Enter 排队后按 Esc 打断：排队消息在之后执行。
3. CLI 自行开始的排队消息那一轮显示为“工作中”。

分别撤掉“立即发送时打断”或“`system init` 标记为工作中”，测试均失败。

## 尚未验证

- 未用真实账号在应用内点按“立即发送”；依据为真实 CLI 行为测试与替身 CLI 回归。
- Windows 上未运行该回归脚本，CI 不运行它。

安装包尚未签名/公证。
