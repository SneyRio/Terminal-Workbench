WbSpace 1.2.1。**安装包尚未签名/公证**：macOS 只有临时签名，Windows 没有 Authenticode，首次打开可能被系统拦截，请核对 SHA256SUMS.txt。

- 修复：Claude Code 会话撞上额度上限等 API 错误后一直显示“工作中”。现在也接收这类结束事件 `StopFailure`（Claude Code 2.1.78 及以上）。
- Codex CLI、Qoder CLI、OpenCode 会话也显示“工作中 / 等待输入”，此前一直是“进程运行中”。Qoder 用与 Claude 相同的 hook；Codex 用 hook，并在该账号的 `config.toml` 中登记对这些 hook 的信任（与在 Codex 界面里批准相同）；OpenCode 用插件。
- 回合结束却没有事件的情况（如按 Esc 打断、额度用尽导致请求前就失败），终端 15 秒没有输出时转为“等待输入”。定时任务不受影响。
- Codex 新会话在发出第一条消息前仍显示“进程运行中”。
- 1.0.x 至 1.2.0 可在设置中点击检查更新直接升级；0.4.x 及更早版本需手动安装一次本版本。

下载后先核对 SHA256SUMS.txt。macOS 首次打开需在隐私与安全性中确认“仍要打开”；Windows 可能出现未知发布者提示；企业设备策略可能禁止运行。
