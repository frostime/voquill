# Changelog

本仓库（`frostime/voquill`，上游 [voquill/voquill](https://github.com/voquill/voquill) 的个人 fork）的版本变更记录。
格式遵循 [Keep a Changelog](https://keepachangelog.com/en/2.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

代码层面的分叉差异（哪些实现不能被上游同步覆盖）记在 [`.dev/docs/upstream-divergence.md`](.dev/docs/upstream-divergence.md)。

## [Unreleased]

## [10.0.2] - 2026-09-18

### Added

- 字典页新增"导出"按钮：把词条导出为 txt，一个词一行（顺序与页面一致，空词条跳过）。替换规则的词只导出原始文本。

### Fixed

- 实时输出在"按应用自动选风格"（Based on app）下永远无法触发：该模式解析不到当前风格，逐字模式判定因此始终失败。现在两种风格模式共用同一套风格解析。
- 实时输出开关在转写方式不支持流式时不再可切换，并说明原因——此前它会静默失效。

## [10.0.1] - 2026-09-18

### Fixed

- 安装版启动后被强制进入引导流程，并在结束时失败（`Cannot finish onboarding: user not found`）。原因是旧官方安装残留在 WebView 存储里的登录会话被回放，应用把当前用户解析成旧的云端账号；现在本地资料是唯一身份来源。
- 说明：若你用过 10.0.0 里那次失败的引导，本地资料已被写成"未完成引导"，因此 10.0.1 仍会显示一次引导流程。历史、API key 与偏好都在。

## [10.0.0] - 2026-09-18

首个 fork 版本：Windows Desktop 专属、免登录、完全本地。数据位于 `%APPDATA%\com.voquill.desktop\`。

### Added

- 可恢复录音生命周期：转写失败不再丢弃录音。录音与 History 记录先落盘，转写结果逐步覆盖同一条记录。
- 胶囊进度反馈：悬浮胶囊区分录音、保存、转写、润色四个阶段；录音计时改由原生胶囊用单调时钟本地计算，不再每秒走 IPC。

### Changed

- 应用版本号改为单一来源（`apps/desktop/src-tauri/Cargo.toml`），安装包名、界面版本与可执行文件版本资源都由它推导。
- Dictionary、Writing Styles 与用户资料只读写本地实现，不再经过云端。原先保存在账号里的词条与自定义风格在本 fork 中不可达，需要手动重建（见 README）。
- 账号体系整体退场：登录、订阅与企业版入口全部移除，应用以本地资料启动。

### Removed

- 产品线收缩为 Windows Desktop：移除企业版、移动端、CLI、文档站，以及 macOS / Linux 平台实现。
- 移除登录、支付、订阅、企业版界面，以及远程配对（remote pairing / output receiver）。
- 移除遥测（Mixpanel）。
- 移除自动更新与官方发布设施：updater 插件、安装器 bootstrapper、官方发布 workflow。构建不再需要签名密钥。

### Fixed

- 移除 Mixpanel 后启动白屏（遥测调用读取未初始化实例）。

[Unreleased]: https://github.com/frostime/voquill/compare/v10.0.2...HEAD
[10.0.2]: https://github.com/frostime/voquill/compare/v10.0.1...v10.0.2
[10.0.1]: https://github.com/frostime/voquill/compare/v10.0.0...v10.0.1
[10.0.0]: https://github.com/frostime/voquill/releases/tag/v10.0.0
