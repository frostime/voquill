---
title: Pill Progress Feedback Change Shape
status: accepted
change: pill-progress-feedback
updated: 2026-09-18
---

# Pill Progress Feedback — Change Shape

## Intent

在不改变录音、持久化、转写、润色和输出业务语义的前提下，让 Windows native pill
显示当前真实可观察阶段：录音期间显示本地 `MM:SS` 计时，停止后按实际工作显示
`Saving`、`Transcribing`、`Refining`。

组织原则是：

- TypeScript 录音编排拥有“当前在做什么”的事实，并只在真实边界发送阶段；
- Tauri Rust 只校验、保存并转发统一的 `OverlayPhase`；
- `rust_windows_pill` 独占计时和绘制，不接收每秒 tick；
- 阶段是瞬时 UI 状态，不进入 SQLite、History 或 recording lifecycle 数据模型。

已通过 UI prototype 确认主体构图：胶囊保持现有 `120×32`，Recording 左侧波形、右侧
单调时钟；processing 使用三个动态点加单行英文阶段文字。上方写作风格 tooltip、胶囊
外形、颜色、hover/cancel 和 Assistant panel 保持现状。

## Observable Flow

```text
Normal Dictation
start_recording resolves
  -> Recording 00:00
stop requested
  -> Saving
WAV + History row checkpoint completes
  -> Transcribing
session.finalize completes with raw text
  -> raw checkpoint
actual local generateText call starts (if any)
  -> Refining
complete / fail / cancel
  -> Idle through existing cleanup

Incognito Dictation
Recording -> Transcribing -> optional Refining -> Idle

Agent voice
Recording -> Transcribing -> Idle -> existing Assistant thinking/chat UI
```

阶段规则：

- `Recording` 只在 native recorder 成功启动后开始，启动失败不产生虚假计时；
- `Saving` 只用于会写本地 History 的普通 Dictation；Incognito 和 Agent 跳过；
- `Transcribing` 覆盖 post-stop STT/finalize；
- `Refining` 只在客户端真正即将调用生成模型时进入；Verbatim、无 generation repo、
  streamed output 和已由 server 返回 processed transcript 的路径不显示；
- New Server 将 STT 与可选润色合并在一次不可分辨的 finalize 中，整个请求显示
  `Transcribing`，不猜测服务端内部边界；
- 阶段不设置最短展示时长。`Saving` 很快时允许短暂出现，不为动画增加业务延迟；
- 文本注入没有独立阶段；完成前沿用最后一个真实 processing 阶段；
- 任意失败或显式取消仍走现有 toast/cleanup，并最终进入 `Idle`；
- History 手动 Retranscribe 继续使用列表内 spinner，不占用全局 pill。

## Predicted Diff

```text
apps/desktop/src/
├── types/overlay.types.ts
│   modify  +2–4/-1–2       小改；OverlayPhase 将 loading 替换为
│                            saving/transcribing/refining，保持单一状态源
├── components/root/DictationSideEffects.tsx
│   modify  +20–35/-5–15    中等控制流编辑；在 recorder 成功、stop、持久化完成、
│                            STT 完成和 Agent handoff 的现有边界发送阶段
├── actions/transcribe.actions.ts
│   modify  +5–12/-0–3      PostProcessInput 增加语义 hook，仅在实际 generateText
│                            调用前触发，不向 action 注入 pill/Tauri 依赖
├── strategies/dictation.strategy.ts
│   modify  +4–10/-0–3      将 post-process generation-start hook 映射为 Refining；
│                            server-processed 与 no-op 路径保持 Transcribing
├── actions/transcribe.actions.test.ts
│   create  +90–140         验证 hook 只在真实生成调用前触发，并在 disabled/no-repo
│                            路径不触发；测试行为而非 phase wiring 细节
├── components/microphone/MicrophoneTester.tsx
│   modify  +1–3/-1–3       mechanical；全局占用判断改为 phase != idle
└── components/onboarding/MicCheckForm.tsx
    modify  +1–3/-1–3       mechanical；同上，识别全部 processing phases

apps/desktop/src-tauri/src/
├── domain/overlay.rs
│   modify  +8–14/-2–5      扩展统一 Rust enum 与 string parser
├── state/overlay.rs
│   modify  +10–18/-3–8     扩展原子状态编码；active/idle 语义不变
└── pill_process.rs
    modify  +5–10/-1–4      把新增 enum 序列化为 native pill IPC 字符串

packages/rust_windows_pill/src/
├── ipc.rs
│   modify  +12–25/-1–3     扩展 Phase；集中 is_processing/label 等小型语义；
│                            补 phase JSON 解析测试
├── state.rs
│   modify  +5–12/-0–2      PillState 保存 recording_started_at: Option<Instant>；
│                            不保存 wall-clock 时间
├── pill.rs
│   modify  +25–45/-8–18    phase transition 时开始/清除 timer；processing phases
│                            共用现有 animation tick、visibility 与 cancel 语义
├── draw.rs
│   modify  +70–110/-25–45  按 accepted prototype 绘制缩窄波形、divider、MM:SS、
│                            三点 indicator 与阶段文字；补纯 timer format 测试
└── constants.rs
    modify  +12–22/-5–12    固定内部布局尺寸与 processing animation 参数；
                            保持外部 120×32 不变
```

预计不修改：

- `apps/desktop/src/actions/transcription-lifecycle.actions.ts`：持久化顺序已经提供所需边界，
  不把 UI concern 放入 lifecycle owner；
- `apps/desktop/src-tauri/src/commands.rs`：现有 `set_phase` 已通过 enum parser 转发，接口不变；
- `apps/desktop/src/strategies/agent.strategy.ts`：Agent 的 Transcribing/Idle 由共享 stop orchestration
  负责，strategy 无新责任；
- 数据库 schema/migrations、History、session/provider 实现、output routing；
- `gfx.rs`：现有 text measurement、centered text、line/circle primitives 足够完成 prototype。

## Ownership And Dependencies

### One phase, one transport path

```text
DictationSideEffects / DictationStrategy
  -> invoke("set_phase", semantic phase)
  -> OverlayPhase parser + OverlayState
  -> pill_process JSON IPC
  -> native PillState
  -> draw.rs
```

不并行引入 `loading + processingLabel`、Zustand-only stage 或专用 pill text message。删除
`loading` 后，所有“是否忙碌”判断基于 `phase !== idle`，所有“是否录音”判断继续严格基于
`phase === recording`。

### Refining boundary

`postProcessTranscript` 已独占“是否真的调用 generation repo”的决策。它暴露一个可选的
`onGenerationStart` 语义 hook，在 `generateText()` 前执行；`DictationStrategy` 才把该事件
映射为 pill phase。由此避免：

- orchestration 复制 tone/repo/enterprise 的 skip 规则；
- transcribe action 直接依赖 Tauri overlay；
- Verbatim 或无 provider 时错误显示 Refining。

Retranscribe 不传 hook，因此不会改变全局 pill。

### Recording clock

native pill 在 `non-recording -> recording` transition 捕获 `Instant::now()`；重复收到
`recording` 不重置。离开 Recording 立即清空。渲染时从单调时钟计算 elapsed，避免系统时间
调整，也避免 TypeScript interval 和 IPC 漂移。

格式为总分钟加两位秒数（通常为 `MM:SS`）；分钟超过两位时允许自然扩展，不截断真实时长。
计时区域使用 tabular/monospace glyph 和固定右边界，必要时只向左侵占波形，不改变胶囊宽度。

### Saving eligibility

stop orchestration 使用现有 `strategy.shouldStoreTranscript()` 和当前 Incognito preference
决定停止后的第一阶段：普通 Dictation 为 Saving，Agent/Incognito 为 Transcribing。
该判断只影响瞬时显示；实际是否持久化仍完全由 recording lifecycle action 决定，不能成为
跳过或执行持久化的业务依据。

## Tests And Verification

自动验证：

- Desktop unit tests：generation-start hook 的触发/跳过规则；现有 suite 全量通过；
- `pnpm --filter desktop run build`；
- `cargo test --manifest-path packages/rust_windows_pill/Cargo.toml`：phase IPC 与 timer format；
- `cargo check`、`cargo test --lib` in `apps/desktop/src-tauri`；
- changed-file Prettier/oxlint、`cargo fmt --check`、`git diff --check`；
- 固定尺寸截图或像素检查：Recording、最长文案 Transcribing 在 120×32 内无裁切/重叠。

用户视觉验收：

1. Dictation 录音从 `00:00` 单调递增，波形和计时均清晰；
2. 正常本地持久化依次可见 Saving -> Transcribing；实际 LLM 调用才显示 Refining；
3. Verbatim/no-postprocess 不闪现 Refining；
4. Agent voice 显示计时和 Transcribing，随后交回原 Assistant UI；
5. 失败、取消、快速重复录音后 timer 不沿用，pill 能回 Idle；
6. style tooltip、hover cancel、pill visibility 和文本注入无回归。

## Deliberate Non-Goals

- 不引入完整任务状态机、phase coordinator、后台 job 或 persisted status；
- 不显示百分比、预计剩余时间、成功/失败 phase；
- 不增加 Saving 最短展示时长；
- 不把 stage timings 写入 History；
- 不为服务端 combined finalize 拆造虚假阶段；
- 不让 History Retranscribe 抢占全局 pill；
- 不在本 change 清理旧平台、updater、provider 或宽容模式死代码；
- 不建立 native pill i18n 管线。本次英文文案与现有 `Click to dictate`、`Thinking` 一致。

## Drift Gates

实现中出现以下任一情况时停止并回到 SHAPE 评审：

- 需要第二套 overlay/stage state 才能表达阶段；
- 需要修改 session/provider 接口来猜测 server 内部进度；
- 需要数据库 migration、History 字段或 recording lifecycle 语义变更；
- 需要 TypeScript 每秒发送计时或人为延迟处理；
- 需要改变 Agent conversation、Incognito persistence、Cancel/Discard 或 retry 行为；
- native 文案无法在现有固定尺寸内可靠绘制，必须改变 pill/window 外部尺寸；
- predicted diff 扩散到未列出的业务模块或新增通用 coordinator。

## Accepted Direction

2026-09-18 用户确认 UI prototype，并授权在无产品/架构 blocker 时推进。以下方向 accepted：

- 统一 phase enum 替换 `loading`；
- `onGenerationStart` 是唯一 Refining 边界；
- Agent/Incognito 跳过 Saving；
- combined server finalize 全程 Transcribing；
- 固定 120×32，不为短阶段增加人为停留。
