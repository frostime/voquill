---
title: 与上游 voquill/voquill 的分叉差异
description: 本仓库相对上游的删减/修改/保留清单，以及上游变更的取舍规则；修改删除类代码或处理 upstream 同步前必读。
scope:
  - /**
updated: 2026-09-17
---

# 与上游 voquill/voquill 的分叉差异

本仓库是 `voquill/voquill` 的 Personal fork，定位：**Windows Desktop 专属的个人长期使用版**。
分叉决策的完整契约见 `.dev/proposal/voquill-personal-windows-handoff/`（产品决策、范围矩阵、
SHAPE、两个 SPEC）；当前执行进度见 `.dev/changes/personal-windows-fork/ORCH.md`。

## 分叉基线

| 项 | 值 |
|---|---|
| 上游仓库 | `https://github.com/voquill/voquill`（remote `upstream`） |
| 分叉点 | 上游 `ef8572a3`（2026-08-01），此后上游无新提交 |
| 本仓库起点 | `c37e118`（用户依赖更新，仅 rust_transcription Cargo 版本） |
| 同步策略 | **不追 merge**。上游仅作 bugfix/reference 来源，需要的修复 cherry-pick 或手工移植 |

## 分叉目标（一句话）

保留 Windows Desktop 上所有不依赖 Voquill 官方订阅即可使用的功能，删除其余产品线、
平台与商业耦合；修正录音持久化生命周期（上游 Issue #397：转写失败导致录音丢失）。

**功能保守，依赖激进**：默认保留 > 默认删除；删除模块前必须证明未被保留功能使用。

## 已与上游不同的部分

### 1. 整树删除的产品线

上游是包含 Desktop/Enterprise/Mobile/CLI/Docs 的 monorepo。本仓库已删除：

- `enterprise/`（admin + gateway + docs，独立产品线）
- `mobile/`（Flutter 工程）
- `cli/`
- `apps/docs/`（文档站点；root `docs/` 的工程文档保留）
- `packages/flutter_video_looper`
- `release/`（官方 dev/prod/enterprise 发布渠道配置）
- `.github/workflows/` 中的官方发布编排（release.yml、_release-desktop-impl、
  release-cli/docs/enterprise-*、publish-packages、retry-release）

Desktop 代码内对这些产品的**运行时引用尚未清理**（enterprise flavor、cloud 路径等），
属后续阶段（M3）工作，见下文"尚未与上游不同的部分"。

### 2. 平台收缩为 Windows-only

上游支持 macOS/Windows/Linux。本仓库：

- 删除 `apps/desktop/src-tauri/src/platform/{macos,linux}`、`packages/rust_macos_pill`、
  `packages/rust_gtk_pill`、平台专属 Cargo 依赖（cocoa/gtk 等）、`Info.plist`、
  entitlements、icns、deb/rpm bundle 配置；
- dev 脚本收敛为 Windows-only（`dev` 直接等价原 `dev:windows`）；
- CI（build-desktop.yml）矩阵收缩为 Windows-only。

**刻意保留的平台抽象**（未来 agent 不要当死代码清理）：

- `apps/desktop/src-tauri/src/platform/mod.rs` 的接口路由与 `platform/windows/**` 实现——
  这是 native 能力（accessibility/input/overlay/hotkey/…）的信息隐藏边界；
- TS 侧 `platform.utils`、按平台分支的运行时判断（audio chime、keyboard 符号等）——
  在 Windows 上恒走 windows 分支，行为无害；
- `packages/rust_windows_pill`、`apps/windows-installer`、updater 相关 CI（defer 到外围清理阶段）。

### 3. 删除时的接线规则

删除导致的编译级引用调整（router/main.tsx/scripts）属于删除的必要代价；
除此之外不做结构性重构。**商业 UI 入口允许隐藏**（用户决策，2026-09-13），
但免费功能不得隐藏/降级/伪造（`isPro=true`、`credits=Infinity` 等禁止）。

### 4. 商业产品层拆除（M3，宽容模式）

上游 Desktop 包含账号/订阅/付费体系。本仓库：

- 删除 `components/{payment,pricing,login,enterprise}`、onboarding 的账号引导
  （SignInForm/UnlockedProForm）；onboarding 直接从 `chooseTranscription` 开始；
- 删除 remote pairing / remote output 全套（对端 mobile 已删）：`SessionSideEffects`
  （Firebase 会话广播）、MultiDeviceDialog、MobileAppDialog/ListTile、SenderReceiverChip、
  5 个 remote actions + 2 个 repo；
- router 无 `/login`、`/routing` 路由，Guard 图无 enterprise 节点；WelcomePage 仅本地路径；
- main.tsx 不再初始化 Stripe Elements 与 Mixpanel（Firebase 初始化保留，不发起启动网络请求）。

**宽容模式刻意保留的死代码**（未来 agent 不要当需要修复的悬空引用）：
`actions/pricing.actions`、`actions/payment.actions`、`actions/login.actions`、
`state/payment.state`、`state/pricing.state`、`state/login.state`、
member/stripe/tenant/enterprise/config 的 Cloud 分支 repo、`@voquill/pricing` package、
免费层 UI 的 `openUpgradePlanDialog` 调用（点击后无对话框渲染，即隐藏入口）。

## 尚未与上游不同的部分（计划内变更，勿误判为"上游原样"）

以下是与上游**暂时相同**、但计划中要改的部分。在对应阶段完成前，它们的当前形态
不代表最终形态：

| 部分 | 计划 | 阶段 |
|---|---|---|
| `term.repo`/`tone.repo`/`user.repo`/`config.repo` 的 Cloud 分支、`repos/index.ts` factory | **保留不动**（宽容模式），cloud 路径不可达即达成目的 | M3 已决（不重构） |
| `tauri.enterprise*.conf.json`、`getIsEnterpriseEnabled()` flavor 分支 | 保留死代码（宽容模式） | 无后续 |
| 录音生命周期：`DictationSideEffects.stopRecordingRaw` 先 STT 后 store（STT 失败丢录音） | 改为 persist→history row→STT→raw checkpoint→LLM→final | M4 |
| `repos/index.ts` 的 cloud/enterprise provider 分支 | 删除不可达分支，不重排 | M5 |

## 上游变更的取舍规则

同步上游修复时按此分类：

| 上游变更类别 | 处理 |
|---|---|
| Windows Desktop 核心修复（录音/快捷键/注入/Whisper/SQLite） | **要**，cherry-pick 或手工移植 |
| 本仓库已删除产品线内的改动 | **忽略** |
| 新增付费/订阅/Enterprise 能力 | **忽略** |
| macOS/Linux 平台修复 | **忽略**（无对应实现可移植） |
| 触及被删接线的修复（如引用已删目录） | 手工移植到本仓库的对应结构 |
| 触及"刻意保留抽象"的修复（platform/mod.rs、TS platform utils） | **要**，注意保持抽象边界 |

## 免费功能保护契约

任何阶段都适用（完整版见 `handoff/specs/DESKTOP-FEATURE-PRESERVATION.md`）：

> Windows Desktop 上不依赖官方订阅即可使用的功能，默认行为不变。
> 被删基础设施若被免费功能使用：先迁移到本地实现，再删旧基础设施。

保留能力清单（不变式）：Dictation 全流程、BYOK/local provider、Local Whisper、
History（列表/播放/retranscribe）、Dictionary、Writing Styles/Tones、Assistant/Chats、
API Key 管理、本地 SQLite 与设置、Windows hotkey/overlay/injection、windows-installer。

回归验证基线：`.dev/changes/personal-windows-fork/characterization-checklist.md`。
