# WbSpace 1.1.0 验收

85 项单元测试与生产前端构建通过。macOS 打包应用通过发布、导航、会话管理、账号卡片、额度栏、终端控制、Git 面板、协议、官方登录和定时任务回归。

- 定时任务回归（`scripts/schedule-regression.mjs`）用替身 Codex 验证只读运行、工作树运行（项目目录和工作区不受影响）、删除工作树、重叠跳过、失败记录、额度跳过、启动补跑与中断标记。
- Git 回归（`scripts/git-view-regression.mjs`）对本地裸仓库验证分支切换、暂存、提交、推送和拉取。
- 跨 Agent 接力回归（`scripts/agent-official-regression.mjs`）验证 Codex 与 OpenCode 之间的会话交接。

## 尚未验证

- 真实 Agent 的无人值守运行（会消耗额度），尤其是只读模式能否拦住写操作。
- 定时任务超时与系统通知路径。
- 个人 Windows 10/11 桌面；Windows 上提示词含 `"`、`%`、`^` 时会被拒绝。

安装包尚未签名/公证。
