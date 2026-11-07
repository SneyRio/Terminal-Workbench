# WbSpace 1.0.1 验收

78 项单元测试与生产前端构建通过。macOS 打包应用通过发布回归，其中用本地代理服务确认更新请求确实经过所设代理，且只走独立网络会话。

1.0.0 的跳转域名检查依赖 `response.url`，而 Electron 的 `net.fetch` 返回空值，因此在应用中没有生效（SHA-256 校验不受影响）。1.0.1 改为在更新会话的网络层拦截，每个请求和跳转都只能访问 GitHub 的 HTTPS 地址。

`scripts/update-proxy-check.mjs` 用打包应用和真实代理向 GitHub 发出更新检查和下载（`update-proxy-check.json`）。

## 1.0.0 发布后核对

用应用的更新代码经代理真实下载 Mac ZIP 和 Windows 安装版，SHA-256 校验和 Mac 包结构检查通过。Windows 一键更新脚本由 CI 在 Windows Server 2022 实际执行：等待旧进程、静默重装到原目录、保留数据并重启。

## 尚未验证

- 从 1.0.0 点击按钮更新到 1.0.1 的完整流程，需要在真实安装上操作。
- 个人 Windows 10/11 桌面。

安装包尚未签名/公证。
