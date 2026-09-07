# Privacy

## English

Scientific Illustrator runs locally and provides no telemetry, analytics, account collection, or hosted service.

- The draw.io live connection binds only to `127.0.0.1` and calls draw.io Desktop's graph API through a local debugging channel.
- Windows Microsoft PowerPoint uses local PowerShell and Office COM. Live Microsoft PowerPoint for Mac uses an HTTPS command bridge bound only to `127.0.0.1`, a random session token, and a user-reviewed localhost certificate; its setup script never changes macOS certificate trust automatically. The Mac fallback and WPS Presentation use an isolated local PPTX working copy and local application launch facilities. No presentation backend exposes a public listening port.
- The plugin itself does not upload presentations, draw.io documents, or reference images to a separate server.
- Images, text, and tool results supplied to Codex remain subject to the user's Codex, model-provider, and organization settings. Those services are outside this plugin.
- Remove confidential material, personal information, and unpublished research data before sharing outputs publicly.

## 中文

Scientific Illustrator 在本机运行，不提供遥测、统计分析、账号收集或托管服务。

- draw.io 实时连接仅绑定 `127.0.0.1`，通过本地调试通道调用 draw.io 桌面应用自身的图模型 API。
- Windows Microsoft PowerPoint 连接通过本机 PowerShell 与 Office COM 完成。Mac PowerPoint 的 Office.js 实时模式使用只绑定 `127.0.0.1` 的本机 HTTPS 桥、随机会话令牌和用户自行信任的 localhost 证书；证书设置脚本不会自动修改 macOS 钥匙串信任。Mac PowerPoint 的兜底模式和 Windows/macOS WPS 使用本地标准 PPTX 工作副本与本机应用启动接口。均不提供公网监听端口。
- 插件自身不会把演示文稿、draw.io 文档或参考图上传到独立服务器。
- 用户在 Codex 中附加的图片、文本以及工具返回内容，仍受用户所选择的 Codex、模型提供商与组织策略约束；这些服务不属于本插件。
- 发布前请移除图中的保密内容、个人信息和未公开研究数据。
