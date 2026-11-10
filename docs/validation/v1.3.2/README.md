# WbSpace 1.3.2 验收

111 项单元测试、类型检查与生产前端构建通过；`schedule-session-regression`、新增的 `quit-keeps-sessions-regression` 通过。

- 现象：1.3.1 自动更新后，本机数据中更新前在运行的两个 Claude 会话状态为 `exited`、退出码 129（SIGHUP），因而不在会话列表中。
- `quit-keeps-sessions-regression`：两个会话，一个手动结束，退出应用后重启，未手动结束的显示为“已中断”，手动结束的保持隐藏。

## 尚未验证

- 该回归在修复前的代码上也能通过（本机替身 CLI 退出过快，状态写入未在退出前完成），未能复现原问题；修复依据为代码路径分析与本机数据。
- `session-management-regression` 在修复前后均失败（新建 Claude 会话按钮的等待超时），与本次改动无关，CI 不运行。

安装包尚未签名/公证。
