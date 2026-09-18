---
title: 已知残留与待清理项
description: 本 fork 中尚未清理的残留代码、待定的能力削减，以及未解决的缺陷。判断某个文件能不能删之前，连同 upstream-divergence.md 的禁清理项一起看。
scope:
  - /**
updated: 2026-09-18
---

# 已知残留与待清理项

分工：`upstream-divergence.md` 记"有意保留、不得清理"的东西；本文件记"可以清理但还没做"和"已知缺陷"。
两者都不代表计划或承诺，只描述当前状态。

## 未解决缺陷

### `pnpm run gen:bindings` 无法运行

`cargo run --example gen_bindings`（`scripts/bindings.sh`）编译通过，但生成的二进制在加载阶段失败，
退出码 `0xC0000139`（`STATUS_ENTRYPOINT_NOT_FOUND`）。

已排除的怀疑：该 example 的导入 DLL 集合是 app 二进制导入集合的子集（`objdump -p` 比对），
逐项核对系统 DLL 的导出后没有发现缺失项；app 二进制在同一台机器上可以正常启动。原因未定位。

后果：**改动 Tauri command 之后必须手工同步** `packages/desktop-native-apis/src/bindings.ts`。
最近一次手工同步是 2026-09-18 移除 updater 时（删除 `setMenuIcon`、`MenuIconVariant` 与早已失效的
`downloadAndOpenMacInstaller`）。

## 可清理，但未做

### 商业 UI 及其挂载点

这些组件的渲染门在当前账号状态下恒为 false，因此不可见：

| 组件 | 渲染门 | 挂载点 |
|---|---|---|
| `components/common/TrialCountdown.tsx` | `getIsOnTrial` | `components/root/Header.tsx` |
| `components/common/FreeWordsRemaining.tsx` | `plan === "free"` | `components/root/Header.tsx` |
| `components/home/OutOfWordsCard.tsx` | `member.plan === "free" && state.config` | `components/home/HomePage.tsx` |
| `components/home/TrialExtensionCard.tsx` | `getIsOnTrial` | `components/home/HomePage.tsx` |
| `components/dashboard/TrialEndedDialog.tsx` | `shouldShowUpgradeDialog && wordsThisWeek >= 阈值` | `components/dashboard/DashboardPage.tsx` |
| `components/settings/VoquillCloudSetting.tsx` | `effectiveMode === "cloud"` | 三个 `components/settings/AI*Configuration.tsx` |
| `components/settings/DeleteAccountDialog.tsx` | `isSignedIn` | `components/root/RootDialogs.tsx` |
| `components/transcriptions/FlagTranscriptionDialog.tsx` | `getIsVoquillCloudUser` | `components/root/RootDialogs.tsx` |

`plan` 对本地用户恒为 `community`、`member` 恒为 null、永不登录，所以上表条件都不成立。

**当前唯一可见的商业入口**是 `Header.tsx` 头像菜单里的 "Upgrade to Pro"（门为 `!isPro`）。
点击后调用已删除的对话框，因此没有任何反应。

删除时需要同时改上表的挂载点，以及 `components/settings/SettingsPage.tsx` 里为
`ChangePasswordDialog`（已删）留下的死 handler `openChangePasswordDialog`
（只写 `settings.changePasswordDialogOpen`，无读者）。

### 商业与云端死代码，及其依赖

`repos/index.ts` 里 member/stripe/tenant/config/enterprise/auth 的选择分支仍被这批死代码调用：
`actions/login.actions.ts`、`actions/member.actions.ts`、`utils/price.utils.ts`、
`components/root/AppSideEffects.tsx`、`components/settings/SettingsPage.tsx`。
所以"provider 选择不再知道 member/credits/cloud/enterprise"这件事无法单独完成。

随这批死代码一起可清：`firebase`、`mixpanel-browser`、`@voquill/pricing`、`@voquill/functions`、
`packages/{firemix,pricing,functions}`。

两个反向约束：

- `@firemix/core`（npm 包）**不能删**：`packages/types` 的多个类型文件使用 `FiremixTimestamp`。
- 混合层被免费功能读取，删除会改变到可见行为：`state/app.state.ts` 的
  `auth`/`memberById`/`myTenant`/`config`/`payment`/`pricing` 字段、
  `utils/member.utils.ts`（Header 的 plan 名称与 `isPro` 来自它）、
  `utils/enterprise.utils.ts`（17 个文件引用）、`utils/user.utils.ts`、`actions/user.actions.ts`。
  动这一层需要按 `.dev/changes/personal-windows-fork/characterization-checklist.md` 复验一遍，
  不能只靠 `tsc`。

### 官方云转写路径（NewServer）

`main.tsx` 的 Firebase init、`sessions/new-server-transcription-session.ts`（539 行）、
`utils/new-server.utils.ts`、`repos/transcribe-audio.repo.ts` 中的 NewServer 实现。
它用 Firebase ID token 调官方云 STT。

这**不是纯清理**：删掉等于失去"官方云转写"这个 provider 选项。本地用户默认用不到它
（`community` plan 会回落到 local Whisper），所以前提是先确认接受这个能力减少。

### 无引用的孤立文件

`apps/desktop/src` 下静态 import 图显示这些文件没有任何引用者（项目无路径别名、无 `require`）：

```text
components/common/{AnimateIn,AppCircularProgress,AppFab,AppStepper,AppTable,Breadcrumb,
  CenterLoading,CenterMessage,ChildCycler,CopyableCommand,EditTypography,PromptLeave,
  SplitLayout,YouTubeVideo}.tsx
components/home/Stat.tsx
components/onboarding/OnboardingShared.tsx
components/root/AppWrapper.tsx
components/settings/GroqModelPicker.tsx
components/transcriptions/TranscriptionToneMenu.tsx
hooks/{gpu,navigation}.hooks.ts
utils/gpu.utils.ts
```

多为删除上游产品线（enterprise/mobile/cli/docs site）时遗留的通用组件。删除不影响行为；是否保留作为参考由使用者决定。

### enterprise flavor 残留

没有任何构建使用它们，但仍在仓库里：

- `apps/desktop/src-tauri/tauri.enterprise.conf.json`、`tauri.enterprise-dev.conf.json`
  （仍含 updater 配置，而 updater 已于 2026-09-18 移除）
- `scripts/start-desktop.ps1`、`scripts/start-desktop.sh`
- `apps/desktop/.env.enterprise`、`.env.enterprise-dev`
- `apps/desktop/scripts/run-vite-with-flavor.mjs` 的 flavor 机制与 `tauri.{dev,local,prod}.conf.json`
  的多 identifier 配置（个人使用只需要一个）
- `getIsEnterpriseEnabled()` 及其在各处的分支

同时注意：`apps/desktop/.env.{dev,prod,emulators}` 与上面两个 enterprise env 文件都被 git 跟踪
且未被 ignore，内容是上游 Firebase 项目配置，构建默认 mode=prod 会用到 `.env.prod`。
