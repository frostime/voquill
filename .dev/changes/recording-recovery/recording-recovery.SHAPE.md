---
status: completed
change: recording-recovery
base: main@1a8b61f5
branch: feat/recording-recovery
---

# SHAPE — 可恢复录音生命周期

## Change narrative

正常 Dictation 在 recorder 返回有效完整音频后，必须先将 WAV 与 History 记录持久化，再进行 post-stop STT finalize、LLM 润色和文本输出。STT/LLM/注入失败只能影响派生结果，不能删除用户已经录下的音频。

本 change 采用现有 `Transcription` 的增量 checkpoint，不新增状态机、后台任务、数据库字段或 Rust 业务逻辑。一个新的 lifecycle actions 模块集中拥有稳定 ID、WAV/row 创建、raw checkpoint、最终更新、warnings、Zustand 同步、retention 与词数统计时机。React side-effect 组件仍负责总体控制流，但不再知道持久化细节。

## Predicted diff

```text
apps/desktop/src/
├── actions/
│   ├── transcription-lifecycle.actions.ts
│   │       create  +180–280
│   │       新的持久化生命周期 owner：
│   │       validate audio、生成稳定 ID、保存 WAV、创建初始 row、
│   │       raw checkpoint、failure warning、final completion、
│   │       Zustand registration/update、retention、word stats。
│   │
│   ├── transcription-lifecycle.actions.test.ts
│   │       create  +250–400
│   │       验证调用顺序、单 ID、failure preservation、raw checkpoint、
│   │       retention 与 state update；mock native invoke/repo/store。
│   │
│   ├── transcribe.actions.ts
│   │       modify  +0–30/-140–210  moderate extraction
│   │       保留 STT 与 post-process provider actions；
│   │       原有末端 create/store 逻辑移交 lifecycle owner，
│   │       清理只服务旧 storeTranscription 的 imports/types。
│   │
│   └── transcriptions.actions.ts
│           modify  +25–60/-10–25  small behavior expansion
│           Retranscribe 在 STT 成功后、LLM 前调用同一 raw checkpoint；
│           LLM 失败时保留本轮 raw fallback 与 warnings，仍更新同一 ID。
│
├── components/
│   ├── root/DictationSideEffects.tsx
│   │       modify  +45–80/-25–55  moderate orchestration reorder
│   │       取得稳定 session/strategy 引用；仅对可入 History 的正常 Dictation
│   │       先 await persistRecording；捕获 finalize failure 并保存 warning；
│   │       raw checkpoint 后再调用 strategy；最终 update 而非 create。
│   │       Agent/Incognito/Cancel 路径保持现有语义。
│   │
│   └── transcriptions/TranscriptRow.tsx
│           modify  +5–15/-0–5  minimal UI fallback
│           空 transcript 的已保存录音显示可理解文案；
│           audio 存在时播放器与 Retranscribe 始终可用。
│
└── tests (only if the existing harness cannot cover the owner directly)
        create/modify grouped  +0–150
        仅补足关键 orchestration/fallback 行为；不为覆盖率复制组件实现。

No expected changes:
├── packages/types/**                         no schema/type expansion
├── apps/desktop/src/repos/transcription.repo.ts  existing CRUD is sufficient
├── apps/desktop/src-tauri/src/domain/**      no persisted status enum
├── apps/desktop/src-tauri/src/db/**          no migration/query changes
└── apps/desktop/src-tauri/src/system/audio_store.rs
                                              existing WAV API remains capability-only
```

## Ownership shifts

1. `storeTranscription()` 当前同时拥有“是否保存、WAV 写入、创建 row、state、统计、purge”，且只能在 pipeline 尾部调用。该混合职责拆除。
2. 新 lifecycle actions 模块成为**持久化 checkpoint 的单一 owner**；normal dictation 和 retranscribe 都通过它更新同一 History 实体。
3. `DictationSideEffects` 继续拥有控制流顺序，但只调用深层 lifecycle operation，不拼装 `Transcription` 或直接处理 retention/statistics。
4. Session 仍只负责 STT；Strategy 仍只负责替换、润色与文本输出；Repo 仍只负责 CRUD；Rust 仍只负责 native capability。

## Dependency direction

```text
DictationSideEffects
    ├── TranscriptionSession (STT)
    ├── Strategy (transform/output)
    └── transcription-lifecycle.actions
            ├── TranscriptionRepo
            ├── Tauri store_transcription_audio
            ├── Zustand store
            └── word-stat action

retranscribeTranscription
    ├── transcribeAudio / postProcessTranscript
    └── transcription-lifecycle.actions (raw/final checkpoints)
```

Lifecycle actions may depend on existing repo/native/store APIs. Repo/native code must not depend back on lifecycle or UI concepts.

## Cross-file rules

- Post-stop `session.finalize()` may not run before initial WAV + row checkpoint for history-eligible Dictation.
- Streaming STT performed during recording is preserved; this change controls only the point after the complete audio is returned.
- The initial History entity has one stable ID. Raw and final checkpoints update it; no success/failure path may create a second record.
- An empty transcript is valid for an audio-backed initial record. UI fallback is presentation only; do not persist strings such as `"[Transcription Failed]"` as a state protocol.
- Raw STT text becomes `transcript` fallback before any LLM call. A later null/failed result must never overwrite that fallback with empty text.
- `warnings` accumulate without clearing earlier stage warnings.
- Retention runs after initial row creation, not after successful completion, so failed and successful recordings are treated equally.
- Word stats update once, only from an available final/fallback text. Initial checkpoint never increments words.
- Incognito, Agent voice, explicit Cancel, and invalid audio remain outside History; do not generalize the guarantee to every `stop_recording` response.
- Persistence failure is fatal for this processing attempt: show an explicit error and do not continue to STT/LLM/output.

## Drift gates

Stop and report before expanding the diff if implementation appears to require any of the following:

- a DB migration or persisted processing-state enum;
- changes to Rust audio storage/query behavior;
- a generic pipeline/coordinator/task queue;
- a second retry path instead of checkpointing the existing one;
- Agent/Incognito/Cancel behavior changes;
- scanning the WAV directory to populate History;
- moving text transformation/output responsibilities out of existing Strategy classes.

Mechanical test-support files or small imports/helpers do not constitute material drift.
