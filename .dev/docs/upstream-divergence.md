---
title: 与上游 voquill/voquill 的分叉差异
description: 本 fork 相对上游的差异账本（按时间记录，带 upstream 与本地提交锚点）、当前禁清理项、上游同步规则。修改删除类代码或处理上游同步前必读。
scope:
  - /**
updated: 2026-09-18
last_reviewed_upstream: ef8572a3
---

# 与上游 voquill/voquill 的分叉差异

本仓库是 `voquill/voquill` 的个人 fork：Windows Desktop 专属、免登录、零配置可用。
本文件是分叉差异的**唯一**权威记录。免费功能保护契约见 `AGENTS.md`。

## 一、当前禁清理项

以下是**有意保留**的设计或依赖，不是待清理的死代码。改动前先看账本对应条目的"遗留"。

| 项 | 保留理由 |
|---|---|
| `src-tauri/src/platform/mod.rs` 路由 + `platform/windows/**` | native 能力的信息隐藏边界。实现只剩 Windows，接口仍有价值 |
| TS 侧 `platform.utils` 与平台运行时判断 | Windows 上恒走 windows 分支，行为无害；删除只会增加无收益改动 |
| `repos/index.ts` 的 cloud/enterprise 选择分支、`Cloud*Repo`、`@voquill/functions`、`firebase` | 宽容模式：不可达即达成目的（见 M3 条目） |
| `analytics.utils` 的 `trackX()` stub 及 18 个调用点 | 遥测已移除，调用点是 no-op；删除波及免费功能文件，收益低 |
| `actions/pricing.actions`、`state/{payment,pricing,login}.state`、免费层 UI 的 `openUpgradePlanDialog` 调用 | 这是"隐藏入口"的实现方式：点击后无对话框渲染，不是悬空引用 |
| `TrialCountdown`/`OutOfWordsCard`/`FreeWordsRemaining`/`TrialExtensionCard`/`TrialEndedDialog`/`VoquillCloudSetting`/`DeleteAccountDialog`/`FlagTranscriptionDialog` 及其挂载点 | 渲染门在当前账号状态下恒为 false（`plan=community`、`member=null`、未登录）。可整删，但属未实施的 R1 |
| `src-tauri/examples/gen_bindings.rs` | 用于生成 bindings；其中失效的 macOS 命令已删（见 M6 条目） |

## 二、分叉基线

| 项 | 值 |
|---|---|
| 上游 | `https://github.com/voquill/voquill`（remote `upstream`） |
| 上游锚点 | `ef8572a3`（2026-08-01）——最后一次审查过的上游提交 |
| 分叉起点 | `c37e118`（2026-09-13，仅 rust_transcription 依赖更新） |
| 同步策略 | 不追 merge。上游只作 bugfix 参考，需要者按第四节规则手工移植 |

## 三、差异账本

时间正序。每条记录：改动、`upstream 锚点`（当时的对比基准）、本地提交、遗留项。

### 2026-09-16 → 09-17 · M2 产品线与平台收缩
- upstream 锚点 `ef8572a3`
- `19c6568b` 删 `enterprise/`、`mobile/`、`cli/`、`apps/docs/`、`packages/flutter_video_looper`、`release/`、官方发布 workflow
- `db84d467` 平台收缩为 Windows-only：删 `platform/{macos,linux}`、`rust_macos_pill`、`rust_gtk_pill`、平台 Cargo 依赖、conf 的 mac/linux 段、dev 脚本平台分支、CI 矩阵
- 遗留：`platform/mod.rs` 抽象与 TS 平台工具刻意保留

### 2026-09-17 · M3 商业体系最小拆除（宽容模式）
- upstream 锚点 `ef8572a3`
- `90cdd23c` 删 remote pairing/output 全套（对端 mobile 已删）
- `52b31349` 删 `components/{login,payment,pricing,enterprise}`、onboarding 账号步骤、router 的 `/login` `/routing` 与 Guard enterprise 节点、main.tsx 的 Stripe/Mixpanel
- `80f4eb2b` Mixpanel 根修：`analytics.utils` 改为 no-op stub（此前 `mp.people.set` 读未初始化实例直接白屏）
- 未删除：Firebase init（不发起启动网络请求）、Cloud repo 分支、免费层商业组件
- 遗留：免费层组件渲染门恒 false；云路径失败时降级（`:5001` 连接拒绝、tone overrides 回退内置）

### 2026-09-17 · 分支拓扑与文档定型
- `9d8107ed` 首次记录分叉差异与任务编排
- `bdd4025b` M1–M3 以 `--no-ff` 合入 main 并推送
- `30218eea` README 重写为 fork 声明（AGPLv3 继承 + 上游署名，声明不含 enterprise 专有部分）；`AGENTS.md` 重写为 fork 入口；`.dev/` 对齐 repo layout
- `1a8b61f5` 分支拓扑定稿：`main` ⇄ `origin/main`；`upstream-main` 只读跟踪上游；`frostime-main` 删除

### 2026-09-17 · M4 可恢复录音生命周期（唯一的行为变更）
- upstream 锚点 `ef8572a3`
- `55852714` DEV-SPEC/SHAPE → `2fd81e67` 实现 → `9d52015b` 修长录音数组多余复制 → `75beadd7` 收尾 → `b3653c3b` 合入 main
- 变更：`stop_recording` 取得有效音频后，先 `await` WAV + History row，再做 STT finalize；STT 成功后、LLM 前保存 raw checkpoint；全程更新同一 ID
- 相对上游：上游 `ef8572a3` 是"STT 失败即丢录音、且落盘未 await"

### 2026-09-18 · M5 胶囊进度反馈
- `8feeb075` DEV-SPEC/SHAPE → `547ebe0f` 实现 → `3286491f` 修正 → `a1f488e0` 收尾 → `95b84cb0` 合入 main
- 变更：`OverlayPhase` 由 `idle/recording/loading` 扩为 `idle/recording/saving/transcribing/refining`；录音计时由 native pill 用单调时钟本地计算，不经 IPC 每秒推送
- `3286491f` 修正原因：原实现用 0.94 黑面板覆盖计时区，在圆角处盖掉胶囊描边并与胶囊本体分层；改为单一表面 + 波形 alpha 淡出
- 相对上游：上游只有单一 `loading` 态

### 2026-09-18 · M6 档位 1 外围清理
- `40c911be` 删 `gen_bindings.rs` 中 M2 遗留的失效 macOS 命令（此前使 bare `cargo test` 失败）
- `31b3f311` 删 `docs/{wayland-hotkeys-wlroots,docker}.md`
- `5f218f9b` `getUserRepo`/`getTermRepo`/`getToneRepo` 固定返回 Local，删除失去引用的 `Cloud/Enterprise{Term,Tone}Repo`、`EnterpriseUserRepo`（行为等价：fork 内 `isLoggedIn()`/`isEnterprise()` 不可达）
- `244c179f` ORCH 记录 → `192cf763` 合入 main
- 遗留：其余商业 accessor（member/stripe/tenant/config/enterprise/auth）仍被商业死代码调用，属未实施的 R2

### 2026-09-18 · R0 零引用代码删除
- `7d830124` 删 `mixpanel-browser` 与 `@types/mixpanel-browser`、`analytics.utils.getMixpanel()`、`packages/firemix`、`actions/payment.actions.ts`、`components/settings/ChangePasswordDialog.tsx`
- `1edd772e` 合入 main
- 依据：静态 import 图（344 文件）与 `slsp references` 均为 0 引用
- 注意：`@firemix/core`（npm 依赖）**仍在用**，`packages/types` 的 `FiremixTimestamp` 依赖它；只有 `@voquill/firemix` 这个 workspace 包是孤儿

### 2026-09-18 · 文档清理
- `93f3126a` 删 `docs/checkout-pr-fork.md`、`docs/pathology-page-placeholders.md` 及 9 张无引用图片（`docs/` 约 10.1MB → 90KB）

## 四、上游同步规则

`upstream-main` 是上游 main 的镜像：**该分支上永远不产生本地提交**。

```bash
git fetch upstream main:upstream-main        # 同步（fast-forward）
git rev-parse upstream-main upstream/main    # 校验两者相等
git log --oneline <last_reviewed_upstream>..upstream/main   # 只看增量
```

看完增量后更新本文件 front-matter 的 `last_reviewed_upstream`。上游前进导致 `upstream-main` 变动是正常的；只有它与 `upstream/main` **不相等**才是需要修的问题。

| 上游变更类别 | 处理 |
|---|---|
| Windows Desktop 免费功能修复（录音/快捷键/注入/Whisper/SQLite/History） | **移植**，注意避免覆盖 M4/M5 的生命周期与阶段实现 |
| 本仓库已删除产品线（enterprise/mobile/cli/docs site）内的改动 | 忽略 |
| 新增付费/订阅/Enterprise 能力 | 忽略 |
| macOS/Linux 平台修复 | 忽略（无对应实现） |
| 触及被删接线的修复 | 手工移植到本仓库对应结构 |
| 触及禁清理项的修复 | **移植**，并保持抽象边界 |
| 上游镜像的 tauri.conf / 版本号 / 发布 workflow | 忽略（本 fork 已自有方案，见 `.dev/docs/release.md`） |
