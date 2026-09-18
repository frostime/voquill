---
title: 与上游 voquill/voquill 的分叉差异
description: 本 fork 相对上游的差异（按专题记录，附提交范围）、当前禁清理项、上游同步规则。修改删除类代码或处理上游同步前必读。
scope:
  - /**
updated: 2026-09-18
last_reviewed_upstream: ef8572a3
---

# 与上游 voquill/voquill 的分叉差异

本仓库是 `voquill/voquill` 的个人 fork：Windows Desktop 专属、免登录、完全本地可用。
本文件回答两个问题：**本仓库与上游现在的差别是什么**，**哪些实现不能被上游同步覆盖**。
用户可见的版本变化按发布记在 [`CHANGELOG.md`](../../CHANGELOG.md)，免费功能保护契约见 `AGENTS.md`。

## 一、当前禁清理项

以下是**有意保留**的设计或依赖，不是待清理的死代码。改动前先看对应专题的"遗留"。
"可以清理但还没做"的残留与已知缺陷记在 `known-residue.md`。

| 项 | 保留理由 |
|---|---|
| `src-tauri/src/platform/mod.rs` 路由 + `platform/windows/**` | native 能力的信息隐藏边界。实现只剩 Windows，接口仍有价值 |
| TS 侧 `platform.utils` 与平台运行时判断 | Windows 上恒走 windows 分支，行为无害；删除只会增加无收益改动 |
| `repos/index.ts` 的 cloud/enterprise 选择分支、`Cloud*Repo`、`@voquill/functions`、`firebase` | 宽容模式：不可达即达成目的（见"商业体系拆除"） |
| `analytics.utils` 的 `trackX()` stub 及 18 个调用点 | 遥测已移除，调用点是 no-op；删除波及免费功能文件，收益低 |
| `actions/pricing.actions`、`state/{payment,pricing,login}.state`、免费层 UI 的 `openUpgradePlanDialog` 调用 | 这是"隐藏入口"的实现方式：点击后无对话框渲染，不是悬空引用 |
| `src-tauri/examples/gen_bindings.rs` | 用于生成 bindings；其中失效的 macOS 命令已删（见"仓库与文档整理"） |

## 二、分叉基线

| 项 | 值 |
|---|---|
| 上游 | `https://github.com/voquill/voquill`（remote `upstream`） |
| 上游锚点 | `ef8572a3`（2026-08-01）——最后一次审查过的上游提交 |
| 分叉起点 | `c37e118`（2026-09-13，仅 rust_transcription 依赖更新） |
| 同步策略 | 不追 merge。上游只作 bugfix 参考，需要者按第四节规则手工移植 |

## 三、差异专题

专题是差异的组织单位，不按时间或提交排列，也不编号——新增专题只是多一个小节，不牵动其他小节。每个专题记录：提交范围、与上游的实质差别、上游同步时的注意点。
新增差异先并入既有专题；只有确实出现新主题时才新增专题。

### 产品线收缩（只剩 Windows Desktop）

- **提交**：`19c6568b`、`db84d467`（`bdd4025b` 合入 main，2026-09-16 → 09-17）
- **与上游差别**：删除 `enterprise/`、`mobile/`、`cli/`、`apps/docs/`、`packages/flutter_video_looper`、`release/` 与官方发布 workflow；平台收缩为 Windows，删 `platform/{macos,linux}`、`rust_macos_pill`、`rust_gtk_pill`、平台 Cargo 依赖、三个 conf 的 mac/linux 段、dev 脚本的平台分支、CI 矩阵。
- **同步注意**：落在被删产品线或 macOS/Linux 的上游改动一律忽略；Windows 修复若触及 `platform/mod.rs` 抽象边界，需手工移植并保持边界。

### 商业体系拆除（宽容模式）

- **提交**：`90cdd23c`（远程配对与输出）、`52b31349`（登录/支付/定价/企业版 UI + 引导中的 Stripe/Mixpanel）、`80f4eb2b`（Mixpanel 根修）；`bdd4025b` 合入 main
- **与上游差别**：删 `components/{login,payment,pricing,enterprise}`、onboarding 的账号步骤、router 的 `/login` `/routing` 与 Guard 的 enterprise 节点、`main.tsx` 的 Stripe/Mixpanel 引导；`analytics.utils` 改为 no-op stub。
- **同步注意**：上游在商业/订阅/企业版路径上的修复与新增一律忽略。若上游修复落在被保留的免费功能文件内（例如同一文件里既有权重也有商业调用），只移植免费功能部分。
- **遗留**：Firebase init（不发起启动网络请求）、Cloud repo 分支与免费层商业组件仍保留，见禁清理项与 `known-residue.md`。

### 云端依赖收敛与本地身份

- **提交**：`5f218f9b`（免费功能 repo 固定本地）、`84584ba4` + `0860c7f1`（v10.0.1 身份修复）、`7f3f0e39`（README 声明账户侧数据不迁移）
- **与上游差别**：
  - `getUserRepo`/`getTermRepo`/`getToneRepo` 固定返回 Local 实现，删除已失去引用的 `Cloud/Enterprise{Term,Tone}Repo`、`EnterpriseUserRepo`（行为等价：fork 内 `isLoggedIn()`/`isEnterprise()` 不可达）。
  - 本地资料是唯一身份来源：`getMyEffectiveUserId()` 不再读 `state.auth`，`AppSideEffects` 不再订阅 `onAuthStateChanged`，`state.auth` 恒为 null。
- **上游同步注意**：**不得**恢复"云端会话 → 当前用户"的解析路径。上游若继续重构 auth 引导或 Firebase 初始化，只取不影响身份解析的部分。身份用错会导致本地资料不可达（v10.0.1 修的正是这个）。同时注意 Dictionary / Writing Styles 的云端数据在 fork 内不可达，属预期。
- **遗留**：`getAuthRepo()` 仍返回 `CloudAuthRepo`、`refreshTokens()` 仍每 5 分钟被调用、`main.tsx` 仍初始化 Firebase，见 `known-residue.md`。

### 可恢复录音生命周期

- **提交**：`55852714` → `2fd81e67` → `9d52015b` → `75beadd7`（`b3653c3b` 合入 main）
- **与上游差别**：`stop_recording` 取得有效音频后，先 `await` WAV 与 History row，再做 STT finalize；STT 成功后、LLM 之前保存 raw checkpoint；全过程更新同一条记录 ID。上游 `ef8572a3` 的行为是"STT 失败即丢录音，且落盘未 await"。
- **同步注意**：上游对 `DictationSideEffects` / `transcribe.actions` / `transcriptions.actions` 的改动移植时必须保留该顺序与同 ID 更新；这是本 fork 唯一以"数据不丢"为目的的行为契约。

### 胶囊进度反馈

- **提交**：`8feeb075` → `547ebe0f` → `3286491f` → `a1f488e0`（`95b84cb0` 合入 main）
- **与上游差别**：`OverlayPhase` 由 `idle/recording/loading` 扩为 `idle/recording/saving/transcribing/refining`；录音计时由原生 pill 用单调时钟本地计算，不经 IPC 每秒推送。上游只有单一 `loading` 态。
- **同步注意**：上游对 overlay phase、pill 绘制（`packages/rust_windows_pill`）的改动需手工融合，保留五个阶段与本地计时。`3286491f` 的修正原因：原实现用 0.94 黑面板覆盖计时区，在圆角处盖掉胶囊描边并与胶囊本体分层；正确做法是单一表面 + 波形 alpha 淡出。

### 实时输出的风格解析

- **提交**：`df4b9871`（未发布）
- **与上游差别**：
  - 逐字实时输出的门控改用 `getDictationToneId()` 解析当前风格，因此在"按应用自动选风格"（Based on app）下也能生效。上游该处调用 `getToneIdToUse(state)` 且不传 app 风格，导致该模式下风格恒为 null、功能永不触发。
  - 实时输出开关由 `getTranscriptionSupportsStreaming()` 门控：转写方式不支持流式时禁用并说明原因。上游无条件显示开关，不支持的供应商下静默失效。
  - 未改动的部分：仍只在 Verbatim 风格下生效，仍只支持 AssemblyAI / Deepgram / ElevenLabs（以及需要账号的 Voquill 云端，本 fork 不可达）。
- **同步注意**：上游若修复同一处，取"用 app 风格解析 + 门控开关"的等价实现即可；不要退回 `getToneIdToUse(state)` 的单参数调用。

### 发布与更新设施

- **提交**：`3b8118be`（版本单一来源）、`a1164dab`（删 updater）、`c39577d0`（删 installer wrapper 与发布残留）、`69b693b0`（发布文档）；`ef4b07ae` 合入 main
- **与上游差别**：
  - 版本号：上游写在 `tauri.conf.json`，并由发布 workflow 用 tag 计数器在构建时覆盖（所以上游仓库长期停在 `0.1.0`，而 release 是 `desktop-v0.0.x`）。本仓库反过来，`apps/desktop/src-tauri/Cargo.toml` 是唯一来源，`tauri.conf.json` 与 `apps/desktop/package.json` 都不再有 `version` 字段；Tauri 回落到 `CARGO_PKG_VERSION`（`tauri-codegen` 的 `context.rs`），因此安装包名、界面版本、启动日志与 exe 版本资源天然一致。首个 fork 版本 `10.0.0`，tag 用 `v<version>`。
  - 删除自动更新全套：TS 侧 actions/state/`UpdateDialog`/`UpdateListTile`/`desktop-utils/updater.ts`、每分钟检查与托盘事件、`MoreSettingsDialog` 的更新开关、`app.state` 的 updater 切片；Rust 侧 `tauri-plugin-updater`、托盘 "Install Update" 项与 update 图标、`set_menu_icon` 命令（`bindings.ts` 手工同步）。
  - 删除官方发布设施：`apps/windows-installer`（内嵌 NSIS 的 bootstrapper）、`scripts/ci/*.mjs`、`scripts/build-desktop.*`、`resign-windows-updater.yml`；`build-desktop.yml` 重写为 Windows-only 并去掉签名密钥注入。效果：`tauri build` 不再需要签名密钥（此前会在打包完成后以 `A public key has been found, but no private key` 失败）。
  - 删除 `packages/bump.sh`：它只遍历 `packages/*/package.json`，且 `sed -i ''` 是 BSD 语法，Windows 上不可用。
- **同步注意**：上游的版本号来源、发布 workflow、dev/prod 双渠道 tag、`latest.json`、签名与 resign 流程一律忽略；本仓库的发布流程见 `release.md`。上游若引入新的 bundle 配置或安装器，只取与 Windows 打包正确性相关的部分。
- **遗留**：`ignoreUpdateDialog` 偏好字段仍留在 Rust domain 结构、DB 列与 preferences payload 中，只是没有界面可改；删除它要动 Rust 结构与 5 处 SQL 映射，收益不足。

### 仓库与文档整理

- **提交**：`40c911be`（bindings 生成）、`31b3f311` + `93f3126a`（文档清理）、`7d830124`（零引用代码）、`30218eea` + `1a8b61f5`（README / AGENTS / `.dev` 布局与分支拓扑）；分别由 `192cf763`、`1edd772e`、`ef4b07ae` 合入 main
- **与上游差别**：
  - `gen_bindings.rs` 中平台收缩时遗留的失效 macOS 命令已删（此前会让 bare `cargo test` 失败）。
  - 删除与本 fork 无关的 `docs/`：`wayland-hotkeys-wlroots.md`、`docker.md`、`checkout-pr-fork.md`、`pathology-page-placeholders.md` 及 9 张无引用图片（`docs/` 约 10.1MB → 90KB）。
  - 删除经静态 import 图与 `slsp references` 双重确认的零引用代码：`mixpanel-browser` 与 `@types/mixpanel-browser`、`analytics.utils.getMixpanel()`、`packages/firemix`、`actions/payment.actions.ts`、`components/settings/ChangePasswordDialog.tsx`。
  - README 重写为 fork 声明（AGPLv3 继承 + 上游署名，声明不含 enterprise 专有部分）；`AGENTS.md` 重写为 fork 入口；`.dev/` 对齐 repo layout；分支拓扑定为 `main` ⇄ `origin/main`，`upstream-main` 只读跟踪上游。
- **同步注意**：`@firemix/core`（npm 依赖）**仍在用**，`packages/types` 的 `FiremixTimestamp` 依赖它；只有 `@voquill/firemix` 这个 workspace 包是孤儿。上游在 `docs/` 下的新增文档默认忽略。

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
| Windows Desktop 免费功能修复（录音/快捷键/注入/Whisper/SQLite/History） | **移植**，并对照"可恢复录音生命周期""胶囊进度反馈""实时输出的风格解析"三个专题保持行为 |
| 本仓库已删除产品线（enterprise/mobile/cli/docs site）内的改动 | 忽略 |
| 新增付费/订阅/Enterprise 能力 | 忽略 |
| macOS/Linux 平台修复 | 忽略（无对应实现） |
| 触及被删接线的修复 | 手工移植到本仓库对应结构 |
| 触及禁清理项的修复 | **移植**，并保持抽象边界 |
| 上游镜像的 tauri.conf / 版本号 / 发布 workflow | 忽略（本 fork 已自有方案，见"发布与更新设施"与 `.dev/docs/release.md`） |
