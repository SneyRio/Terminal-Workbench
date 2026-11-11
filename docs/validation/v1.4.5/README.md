# WbSpace 1.4.5 验收

136 项单元测试、类型检查与生产前端构建通过（在本应用内置终端里运行需先清除应用注入的 `ACCOUNTOR_*`，否则 2 项状态栏用例会按自定义供应商分支执行）。

## 账号切换下拉

- 底部的账号切换改为自绘下拉，菜单通过 portal 渲染，不受状态栏 `overflow:hidden` 影响；靠窗口右侧时自动左移。键盘支持方向键、Home/End、Enter、Esc，Esc 只关闭菜单。
- 用替身账号实跑截图确认显示效果：按「Claude Code」「Codex CLI」分组；`5h 剩 7%` 显示为橙色，`额度用尽` 与 `需要登录` 为红色，`自定义模型` 为灰色；未选中时高亮第一项。选中后按钮显示账号名，并出现「保存并切换」。
- 对话界面的模型/权限下拉与其共用组件；重构后重新截图确认自定义账号仍只列出 `model-a`、`model-b`，初始显示连接的默认模型。

## 回归

`chat-interrupt`、`account-cards`、`connection-provisioning` 全部通过。`switch-ui-smoke` 与 `session-management-regression` 已从 `selectOption` 改为点击后选账号，但依赖 `chat-native-smoke` 生成的 `.test-data/native-cli-*`，本轮未运行。

## 尚未验证

- 未在打包后的应用里用真实账号检查额度标签；依据为替身数据截图与既有用量采集。
- Windows 未运行桌面回归，CI 不运行这些脚本。

安装包尚未签名/公证。
