---
title: Pill Progress Feedback
status: accepted
change: pill-progress-feedback
updated: 2026-09-18
---

# Pill Progress Feedback — DEV-SPEC

## Goal

Windows native pill 应在录音和 post-stop 处理期间提供准确、紧凑的即时反馈，让用户能区分
应用仍在录音、保存音频、执行转写还是调用生成模型润色，同时不改变现有录音业务语义。

## User-Visible Behavior

### Recording

- Native recorder 成功启动后，pill 显示现有动态波形和从 `00:00` 开始的 `MM:SS` 计时；
- 计时使用单调时钟，不受系统时间调整影响；
- 新录音必须重新从零开始，离开 Recording 后不再继续计时；
- pill 保持现有 120×32 外部尺寸，上方写作风格 tooltip 保持现状。

### Processing

普通、非 Incognito Dictation 的阶段顺序为：

```text
Saving -> Transcribing -> Refining（仅实际调用生成模型时）-> Idle
```

- `Saving` 从停止录音开始，覆盖取得完整音频并持久化 WAV + History row；
- `Transcribing` 在持久化 checkpoint 完成后显示，覆盖 post-stop STT/finalize；
- `Refining` 只在客户端实际开始 generation request 时显示；
- Verbatim、未配置 generation repo、streamed output 或 server 已返回 processed transcript 时，
  不显示虚假的 Refining；
- New Server 内部合并 STT 与润色时，全程显示 Transcribing；
- 阶段使用三个动态点和英文单行文案，不显示百分比或剩余时间；
- 不为瞬时阶段引入最低展示时长。

### Mode Differences

- Incognito Dictation：`Recording -> Transcribing -> optional Refining -> Idle`，不显示 Saving；
- Agent voice：`Recording -> Transcribing -> Idle`，随后继续现有 Assistant thinking/chat UI；
- History Retranscribe：保持列表内 spinner，不驱动全局 pill。

### Failure And Cancel

- 录音启动失败不得开始计时；
- 保存、STT、LLM、输出失败继续使用现有错误反馈与恢复语义；
- Cancel/Discard 和异常 cleanup 最终必须将 pill 恢复为 Idle；
- 本 change 不改变音频持久化、History checkpoint、retry 或 Incognito 数据语义。

## Architecture Contract

- TypeScript orchestration 是业务阶段事实来源；
- Tauri Rust 只校验、保存、广播和转发 `OverlayPhase`；
- native pill 独占 timer 和 visual animation；TypeScript 不发送周期 tick；
- 使用一个统一 phase 值，不并行维护 loading flag 与 label；
- processing phase 不持久化到 SQLite/Zustand 以外的 durable storage；
- post-processing action 只暴露 generation-start 语义 hook，不直接依赖 Tauri 或 pill。

详细 predicted diff、ownership、测试和 drift gates 见
`pill-progress-feedback.SHAPE.md`。

## Acceptance Criteria

1. 正常 Dictation 的 Recording timer 单调递增，波形和时间无重叠、无尺寸跳动；
2. WAV/History checkpoint 前显示 Saving，之后显示 Transcribing；
3. 只有真实客户端 LLM 调用显示 Refining；跳过后处理的路径不闪现；
4. Agent、Incognito 和 combined server 路径符合各自阶段序列；
5. 成功、失败、取消、连续两次录音后都能正确回 Idle，timer 不沿用；
6. 现有 style tooltip、hover cancel、visibility、Assistant panel、History 与文本注入无回归；
7. Desktop build/tests、Desktop Rust tests 和 native pill tests 通过；
8. 用户完成 native Windows 视觉 smoke 并确认 prototype 对应效果。

## Non-Goals

- 持久化任务状态、阶段耗时或进度；
- 完整录音状态机、队列或 coordinator；
- 百分比、ETA、Success/Failed/Inserting 阶段；
- server 内部阶段推断；
- native pill i18n 管线；
- updater、provider、release 或其他 M6 清理。
