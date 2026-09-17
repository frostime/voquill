# Personal Windows Fork — 任务编排脚本

> 记法遵循 `task-orchestration-script` SKILL。本脚本是计划与状态记录，不授权执行。
> 产品契约来源：`.dev/proposal/voquill-personal-windows-handoff/`（AGENT-INSTRUCTIONS、USER-DECISIONS、SCOPE-MATRIX、SHAPE、MIGRATION-PLAN、两个 SPEC）。
> 最高约束：Windows Desktop 上不依赖官方订阅即可使用的功能，默认行为不变。

## 最终交付物（Goal）

一个 Windows-only、Desktop-only 的 Voquill Personal fork：

- 所有免费 Desktop 功能行为不变；
- 无 Enterprise / Mobile / macOS / Linux / 官方订阅 / 商业支付依赖；
- 录音一旦完成即持久化，任何上游失败不丢录音、不丢历史；
- 每个 Milestone 结束时仓库可 build、可运行、可回滚。

## Milestone 概览（每个 M 有独立可交付产物）

```text
M1  Baseline 计划冻结        → 可运行基线 + characterization 记录 + accepted SHAPE
M2  Windows-only 独立仓库    → 只含 Desktop 的可运行 monorepo（行为与 M1 一致）
M3  商业体系最小拆除         → 免登录、付费 UI 不可达、免费功能全可用的本地版
M4  可恢复录音生命周期       → 音频先持久化 + History 手动恢复 + 故障注入验收
M5  胶囊进度反馈             → 录音计时 + Saving/Transcribing/Refining 阶段反馈
M6  Provider 与外围收尾      → repos/index.ts 收缩 + 外围清理 + 最终形态
```

Milestones 之间串行推进；M 内部允许并行分支。

---

# M1 — Baseline 与计划冻结 `DONE`
    自动化已验证：TS build、282 单测、cargo check、32 Rust 单测通过。
    2026-09-16 用户完成手工 smoke：常用功能全部正常，characterization 契约已确认。

[锁定 baseline 与环境记录]
    运行 Windows Desktop build 与 dev 启动；记录 SHA（当前 c37e118）、Node/pnpm/Rust/Windows 版本、build/test 命令。
    IF build 或运行失败
        先修复环境问题，修复本身记入 baseline commit。
    END
    产出：baseline 记录（环境 + 命令 + 已知可用 provider 配置）。

[characterization 基线] `DONE`
    2026-09-16 用户在 Windows 上完成 smoke：常用功能全部正常。结果记录在
    `.dev/changes/personal-windows-fork/characterization-checklist.md`。此为 M3+ 的回归契约。
    按 `specs/DESKTOP-FEATURE-PRESERVATION.md` 保留能力清单手工 smoke：
    record/stop、hotkey、overlay、text injection、History、playback、retranscribe、
    BYOK STT、AI post-process、Local Whisper、Dictionary、Writing Styles、
    Assistant/Chats、API key settings。
    记录每项的当前行为与验证方式（此为后续所有阶段的 regression contract）。
    DEFER 是否将部分手工项固化为自动化测试
        仅当某项手工验证成本高且 Phase 6 前必然被改动时，才为该单项补测试。

[SHAPE 升级 accepted]
    已完成初步校验：录音问题现状与 SHAPE/spec 描述一致，关键触点文件均在预测位置，无 material drift。
    待 baseline 确认后把 `personal-windows-fork.SHAPE.md` 状态改为 accepted，并记录校验结论。

[upstream 策略记录]
    记录：upstream/main = ef8572a3（2026-08-01），无新 commit；fork 长期独立，
    upstream 仅作 bugfix/reference 来源，修复走 cherry-pick / 手工移植。

    M1 退出条件：baseline 可运行 + characterization 记录 + SHAPE accepted。
    IF 任一 characterization 项与 spec 预期不符
        停止推进，先向用户报告差异，再修订 SHAPE/spec。
    END

---

# M2 — Windows-only 独立仓库 `DONE`
    2026-09-16 完成：产品线删除 + 平台裁剪两个 commit（764 文件 -65657 行；89 文件 -16089 行）。
    验证：tsc+vite build、282 TS 测试、cargo check、32 Rust 测试全部通过。
    保留：windows-installer、root docs/、TS 平台工具函数（抽象边界）、
    updater 与 resign CI（M5 外围处理）、tauri.enterprise*.conf.json（M3 flavor 处理）。

    REQUIRES [M1 完成]：baseline 可运行，characterization 记录存在。

    原则：只做结构减法，不改 Desktop 行为；每删除一块立刻 build/test。

INDEPENDENT
- [删除 enterprise 产品树]
    `enterprise/**`；Desktop 内 enterprise flavor/env/config/license 检测、
    `getIsEnterpriseEnabled()` 分支、enterprise tauri conf。
- [删除 mobile 产品树]
    `mobile/**`、`packages/flutter_video_looper`、mobile CI。
- [删除 docs site]
    `apps/docs/**`；先证明 workspace 无 build 依赖。root `docs/` 保留。
- [删除 cli]
    先证明 Desktop 无 runtime/build 依赖（workspace caller / import / script），
    然后整树删除。
END

[裁剪 macOS 与 Linux]
    REQUIRES [M2 删除 enterprise 产品树] 的 workspace 配置变更先合入（避免脚本/CI 改两次）。
    先 inventory：`target_os = "macos"/"linux"`、`cfg(target_os`、平台包、脚本、bundle、CI。
    删除：`src-tauri/src/platform/{macos,linux}`、`packages/rust_macos_pill`、
    `packages/rust_gtk_pill`、dev:mac/dev:linux(:gpu) 脚本、平台 sidecar/bundle/CI。
    规则：只删 implementation 与 build 设施；保留有信息隐藏价值的 native 接口
    （TextInsertion/GlobalHotkey/Recording/Overlay 的抽象边界），即使实现只剩 Windows。

[workspace 收尾]
    pnpm-workspace.yaml / turbo.json / root package.json / lockfile 同步清理。
    保留 apps/desktop、apps/windows-installer（第一轮）、root docs/、需要的 packages。

    M2 退出条件：Windows dev/build/smoke 全通过；characterization 全部一致。

---

# M3 — 商业体系最小拆除 `DONE`
    REQUIRES [M2 完成]: DONE
    2026-09-17 用户 smoke 验证通过：启动无登录阻塞直达 dashboard，付费入口不可见，
    常用功能全部正常（含写入思源的文本注入）。云路径残留失败时均正确降级
    （tone overrides → built-in styles）。
    2026-09-13 用户决策（宽容模式）：只删容易删的，不做结构性重构；允许残留无关代码；
    允许隐藏商业 UI 入口。原 handoff 中"不得隐藏 UI"约束针对的是免费功能保护，
    隐藏商业入口不违反其本意，本脚本按用户决策显式放宽。
    风险控制原则：删除以编译通过为限；因删除导致的接线级最小修改
    （router/main.tsx 的引用调整）属于删除的必要代价，不视为重构。

[商业依赖审计地图]（轻量版）
    目的从"指导迁移"降为"避免删坏"：为每个候选删除模块列出 caller，
    区分整块可删（caller 仅商业 UI）与有接线牵连（router/store/repos 引用）。
    注意已确认事实：term/tone/user 的 Cloud 分支、repos/index.ts 的
    isEnterprise()/isLoggedIn() 结构均保留不动（宽容模式不做 B 类拆分）。

[删除整块自包含商业模块]
    只删 caller 清晰、牵连小的整块：components/payment、pricing、enterprise
    及对应 state（payment.state/pricing.state）；member/stripe/tenant/enterprise repo
    仅当 caller 列表确认牵连小时才删，否则保留为死代码。
    不动 term/tone/user 的 Cloud 分支，不动 repos/index.ts 的 factory 结构。
    禁止 isPro=true、credits=Infinity 等伪造手段。

[入口接线最小修改]
    仅因删除导致编译需要才动：
    router 去掉 login/payment/pricing/enterprise 路由与 Guard，直达 dashboard；
    main.tsx 移除 Stripe Elements 与 Mixpanel init（小编辑）。
    IF 断网启动被 Firebase 初始化阻塞
        才移除 main.tsx 的 Firebase 初始化（同属小编辑）。
    ELSE
        Firebase init 可保留（不发起启动网络请求时无害）。
    END
    明确不做：localize B 类免费功能、重排 repos/index.ts、provider factory 重构
    （这些留给后续阶段或永不执行）。

[删除 remote pairing / remote output 功能]
    2026-09-16 用户决策：删除。理由：对端是 mobile（产品线已删），功能在此 fork 永久不可用。
    范围：remote-pairing/remote-output/remote-transcript/remote-receiver 相关 actions、
    state、UI 入口、paired-remote-device.repo、SenderReceiverChip 等配对界面；
    caller 审计后决定 repo 文件是整删还是留死代码。
    与商业模块删除分开 commit。

    M3 退出条件：启动无登录阻塞、付费 UI 不再可达（或不可见）、
    免费功能 characterization 全部一致；不要求"断网零 Firebase 引用"。
    残留死代码（Cloud repos、firebase 依赖）可接受，后续阶段有余力再清。

---

# M4 — 可恢复录音生命周期 `IN PROGRESS`  << CURRENT

    REQUIRES [M3 完成]：DONE。
    独立 change：`.dev/changes/recording-recovery/recording-recovery.DEV-SPEC.md`。
    独立分支：`feat/recording-recovery`（基于 main@1a8b61f5）。

[确认行为与架构边界] `DONE`
    2026-09-17 用户确认：正常 Dictation、非 Incognito、非显式 Cancel 才进入保证范围；
    本地存储失败显式报错但不做内存队列/orphan scan；恢复由 History 手动 Retranscribe。
    采用现有 Transcription 的 recorded/transcribed/completed 持久化检查点，
    不新增状态机、数据库状态字段、后台队列或第二套 History 数据源。

[实现持久化检查点]
    stop 返回有效音频后，先 await WAV + History row，再进行 post-stop STT finalize；
    STT 成功后在 LLM 前保存 raw fallback；最终结果更新同一 ID。
    失败录音与成功录音执行相同的 20 条音频 retention。

[修正 retry 检查点]
    现有 Retranscribe 继续从本地音频重跑，但 STT 成功后必须在 LLM 前保存 raw；
    LLM 失败不得丢掉本轮已取得的 raw transcript。

[故障注入验收]
    验证无效 API Key/空 transcript、LLM 失败、初始 checkpoint 后强制退出；
    app restart 后 recording 可见、可播放、可手动 retry。

    M4 退出条件：DEV-SPEC Acceptance Criteria 全部满足，用户 smoke 通过；
    change 独立 merge 回 main 后结束该分支。

---

# M5 — 胶囊进度反馈 `TODO`

    REQUIRES [M4 完成]：使用稳定后的 recording lifecycle 阶段边界，避免重复修改。
    必须作为独立 change / branch 实施，不与 recording recovery 混合。

[录音计时]
    Recording 阶段在 native Windows pill 显示 MM:SS；native 单调时钟计时，
    不由 TypeScript 每秒跨 IPC 推送；离开 Recording 后停止并重置。

[处理阶段反馈]
    Dictation 显示 Saving → Transcribing → Refining（仅实际启用 LLM 时）；
    Agent voice 显示计时与 Transcribing，随后交回既有 Assistant thinking/chat UI，
    不显示 Refining。瞬时 UI phase 不写数据库。

    M5 退出条件：计时准确、阶段与实际处理一致、Dictation/Agent 既有交互无回归；
    独立用户视觉验收通过。

---

# M6 — Provider 与外围收尾 `TODO`

    REQUIRES [M5 完成]。

[Provider selection 清理]（宽容模式同样适用）
    仅删除 M3 拆除后已不再可用/不再可达的 provider 分支（cloud/enterprise path），
    保持 repos/index.ts 既有结构，不做重排；
    BYOK/local providers 保留、行为不变。
    不主动抽 createTranscriptionProvider/createGenerationProvider；
    仅当删除使 factory 出现编译或运行问题时做最小修复。

[外围清理]
    INDEPENDENT
    - [updater 处理]
        OPEN 用户最终决定保留或删除
            用户倾向删除（个人维护直接从 GitHub Releases 下载）。
            最后单独 commit 处理；不影响主迁移。
    - [Mixpanel / analytics 清理]
        若 M3 已随 bootstrap 清除则跳过；否则单独 commit。
    - [stale docs / scripts 清理]
        root docs/ 中 Linux/Wayland/Docker 等无关文档；release automation。
    END

[最终形态清理]
    评估是否仍有认知热点需要 feature-based 物理重组。
    IF 现有目录已足够简单
        跳过物理重组，仅做 lockfile/依赖最终清理。
    END
    DEFER i18n 评估
        最后处理；收益低于 Auth/Firebase 清理，不优先。

    M6 退出条件：最终形态达成；全部 characterization 通过；
    与 accepted SHAPE 的 actual diff 对比无 material drift。

---

# OPEN 事项

RESOLVED Remote pairing / remote output 功能去留 → 删除（2026-09-16 用户决策）
    对端是 mobile（产品线已删），功能永久不可用。纳入 M3 [删除 remote pairing / remote output 功能]。

OPEN Windows installer 保留时长
    第一轮默认保留（scope-matrix：KEEP INITIALLY）。M6 时评估是否继续维护。

OPEN 个人 Releases 渠道
    用户倾向自己发布 GitHub Releases。是否保留任何 release workflow 影响外围清理范围；
    M6 前向用户确认一次即可。

# ASSUME 事项

ASSUME 当前 checkout 的免费功能 characterization 无录音丢失以外的实质缺陷
    依据：upstream 自 2026-08-01 后无更新；已知录音丢失问题与 spec 一致。
    在 [characterization 基线] 执行时验证。
    IF 发现其他实质缺陷
        报告用户，单独评估是否纳入 M4 或另立议题。
    END

---

# 执行记录

- 2026-09-13 环境确认：upstream/main=ef8572a3 无新提交；本地领先 1 commit（update deps，
  仅 rust_transcription 依赖版本）；SHAPE 初步校验无 material drift。
- 2026-09-13 用户决策：M3 改为宽容模式（最小拆除、容忍死代码、允许隐藏商业入口、
  不做结构性重构）；M5 provider 清理同步采用宽容原则。理由：担心大刀阔斧改坏。
- 2026-09-16 M2 完成于分支 chore/personal-prune（基于 c37e118）：
  commit 1 删除产品线（enterprise/mobile/cli/apps/docs/flutter_video_looper + 8 个官方
  release/CI workflow + release/ 目录）；commit 2 删除 macOS/Linux（platform/{macos,linux}、
  两个 pill 包、平台依赖与 conf、脚本平台分支、CI 矩阵收缩为 Windows-only）。
  TS 平台 utils 与 windows-installer 按约定保留。用户手工 smoke（characterization）待回填。
- 2026-09-16 用户完成 characterization smoke：常用功能全部正常，M1 收尾。
  另：dev 构建使用独立数据目录（com.voquill.desktop.dev），首次启动为全新库+welcome，
  属预期行为，非 M2 回归。
- 2026-09-16 新增 `.dev/docs/upstream-divergence.md`：与上游的分叉差异、保留边界与
  upstream 同步取舍规则；后续每阶段完成时同步更新该文档。
- 2026-09-17 M3 代码完成：commit 3 删 remote/mobile 配套（22 文件 -1898 行）；
  commit 4 删商业 UI + Stripe/Mixpanel bootstrap + onboarding 账号步骤
  （27 文件 -2144 行）。TS build/282 测试全绿。预先存在 prettier lint 报警
  （基线 383 文件，非本次引入，不在本轮修）。M3 退出验证待用户 smoke。
- 2026-09-17 白屏故障定位与修复：main.tsx 去 Mixpanel init 后，AppSideEffects
  的档案同步 effect 读未初始化实例的 mp.people 崩溃。commit 5 根修：
  analytics.utils 改为遥测 stub，删档案同步 effect（2 文件 +16/-140）。
  诊断过程：无头 Chrome + Tauri mock 复现链路（临时文件已删）。
- 2026-09-17 用户 smoke 验证：功能全部正常（含思源注入），M3 收尾。
  已知残留 console 噪音（均预期）：updater 无 endpoints、:5001 functions 连接拒绝、
  tone overrides 降级、VOQUILL_API_KEY_SECRET 未设置（个人机器可接受）。
- 2026-09-16 用户决策：remote pairing/remote output 删除（对端 mobile 已删），
  纳入 M3 独立 commit。M3 全部前置决策已齐备，可开工。
- 2026-09-17 清理阶段收官：chore/personal-prune merge --no-ff 至 frostime-main
  （merge commit bdd4025b），并推送 origin/main（ef8572a3..bdd4025b）。
  后续 M4/M5 从 frostime-main 新开分支；chore/personal-prune 分支可保留作阶段存档。
- 2026-09-17 分支拓扑重构（用户决策）：main = 个人主分支（跟踪 origin/main）；
  upstream-main = 只读跟踪 upstream/main（fetch upstream main:upstream-main 同步，
  不做常规 merge）；frostime-main 已删除。fork 远端残留的 upstream-main 分支已删。
  README 重写（fork 声明 + AGPLv3 继承 + 上游署名）；AGENTS.md 重写为 fork 入口；
  .dev 对齐 repo layout 规范（changes/personal-windows-fork/）。已推 origin/main (30218eea)。
- 2026-09-17 用户确认 M4 为独立功能 change，不按局部 bugfix 处理：建立
  `.dev/changes/recording-recovery/recording-recovery.DEV-SPEC.md` 与分支
  `feat/recording-recovery`（base main@1a8b61f5）。新增胶囊计时/处理阶段反馈作为后续
  独立 M5；原 Provider/外围扫尾顺延为 M6。
