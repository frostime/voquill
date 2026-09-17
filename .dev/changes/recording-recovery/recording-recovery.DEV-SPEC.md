---
status: completed
change: recording-recovery
branch: feat/recording-recovery
---

# 可恢复录音生命周期

## Problem Statement

用户在口述时往往同时组织思路。一次已经完成的录音是不可再生的输入；要求用户在转写服务、API Key、网络或润色服务失败后重新说一遍，会造成很高的时间和认知成本。

当前正常听写流程先执行转写和润色，最后才保存录音与 History 记录。任何发生在保存之前的失败都可能使已经录下的内容完全消失，也无法通过现有“重新转写”功能恢复。

本 change 的成功标准是：正常 Dictation 已取得有效音频后，先建立可重启恢复的本地录音与 History 记录；之后 STT、LLM、文本注入等环节失败，只能使派生处理失败，不能使原始录音消失。

## Approach

继续使用现有 `Transcription` 作为 History 实体，不引入新的 Recording/Job 表或通用任务框架。将一次听写逐步保存为三个持久化检查点：

1. `recorded`：音频文件与 History 记录已经存在；
2. `transcribed`：同一记录已经保存 STT 原文和 STT metadata；
3. `completed`：同一记录已经保存最终文本、润色 metadata 和 warnings。

这些名称用于解释生命周期，不新增数据库状态枚举。记录当前拥有哪些数据，即构成恢复依据：有音频但没有文本时可重新转写；有原文时即使润色失败也仍有可读结果。

应用层拥有检查点顺序；Rust 继续只提供音频文件和 SQLite 能力。History 继续以数据库记录为数据源，不扫描音频目录作为主路径。

选择该方案是为了满足数据安全和恢复需求，同时避免完整状态机、后台队列和跨层 schema 扩张。文件系统与 SQLite 无法构成真正原子事务，因此本 change 不以新增“原子保存”Native API 伪装不存在的一致性保证。

## Behavior Contract

### 适用范围

本保证适用于满足以下条件的录音：

- 正常 Dictation 模式；
- 用户正常停止录音；
- recorder 返回非空 samples 和有效 sample rate；
- Incognito 未启用；
- 用户没有显式 Cancel / Discard。

以下行为保持现状，不强制写入 History：

- Assistant / Agent voice；
- Incognito；
- 用户显式取消；
- 无效或空音频。

### 首个持久化边界

完整音频返回后、调用 post-stop `session.finalize()` 以及任何后续润色或文本输出前，必须依次并 `await`：

1. 保存 WAV；
2. 创建关联同一稳定 ID 的 History 记录；
3. 将记录注册到应用状态；
4. 执行现有音频 retention 清理。

部分 provider 在录音过程中已进行 streaming STT。本保证不改变 streaming 行为；它约束的是完整音频返回后的 finalize 和后续处理不能先于持久化检查点。

### STT 失败

以下情况均视为转写失败：provider 异常、HTTP 错误、无效 API Key、限流、超时、离线、空白 transcript。

失败后：

- WAV 与 History 记录保留；
- History 仍显示播放器和 Retranscribe；
- warnings 保存可诊断错误；
- 不执行文本注入；
- 重启应用后记录仍存在；
- 用户修复配置后可手动重新转写同一条记录。

### STT 成功检查点

获得非空 STT 文本后、开始 LLM 润色前，必须更新同一 History 记录：

- 保存 raw transcript；
- 将 raw transcript 暂作为用户可读 transcript fallback；
- 保存 STT metadata 和已有 warnings；
- 不改变 ID、创建时间或 audio association。

### 后续处理失败

LLM 润色、格式解析或文本注入失败时：

- 原始音频和 raw transcript 不变；
- 最终 transcript 至少保留 raw fallback；
- warnings 追加错误；
- 不创建第二条 History 记录；
- 不要求用户重新录音。

文本注入失败不等于转写失败：已经生成的文本仍应完成持久化。

### Retry

恢复由用户在 History 中手动触发，不增加自动重试或后台队列。

现有重新转写流程继续从本地音频开始，但必须遵循相同的 raw checkpoint 规则：如果重试时 STT 成功而 LLM 失败，raw transcript 仍需保存到原记录。

### Retention

现有“仅保留最近 20 条录音音频”策略保持不变。新录音建立首个持久化检查点后即参与 retention；失败录音不得绕过 purge，也不得获得额外永久保留资格。

### 本地持久化失败

若 WAV 保存或 History 记录创建失败：

- 显示高可见度错误；
- 不继续 STT、LLM 或文本注入；
- 不将流程报告为成功；
- 尽可能记录诊断信息，但不记录音频内容、API Key 或完整 transcript。

本 change 不承诺在磁盘满、权限损坏、SQLite 损坏时仍能永久恢复，也不实现内存恢复队列或 orphan WAV 启动扫描。

## Implementation Decisions

- 新建一个应用层 lifecycle actions 模块，集中拥有稳定 ID、初始录音持久化、raw checkpoint、完成更新、warnings 合并、Zustand 同步、retention 和词数统计时机。
- 录音事件组件继续负责 native event、session、strategy 和总体调用顺序，但不再拥有音频/数据库写入细节。
- Session 只负责 STT；Strategy 继续负责替换、润色和文本输出；Repo 继续负责 CRUD。
- 初始 History 记录允许 transcript 为空，且必须有关联 audio。
- History 对空 transcript 显示用户可理解的 fallback，不把展示字符串写入业务数据作为状态标志。
- 音频播放器和 Retranscribe 的显示只依赖 audio 是否存在，不依赖 transcript 是否成功。
- 最终更新必须保留同一 ID、创建时间、audio 和已保存的 raw transcript；final transcript 缺失时不得覆盖 raw fallback 为空。
- 词数统计只在存在可用文本时更新；初始持久化不增加词数。
- 音频 retention 在初始记录创建后执行，因此成功与失败录音遵循同一策略。
- 不新增数据库 migration、持久化 processing status、通用 pipeline coordinator 或新的 History 数据源。

## Acceptance Criteria

### 自动化验证

- 有效 Dictation 音频在 STT finalize 被调用前，WAV 保存和 History create 均已成功完成。
- WAV 保存失败时不创建正常 History 记录，也不调用 STT。
- History create 失败时不调用 STT。
- STT 抛异常或返回空白文本后，同一记录及 audio 仍存在，warnings 已更新。
- STT 成功后，raw transcript 在任何 LLM 调用前已写入同一记录。
- LLM 失败后，audio、raw transcript 和 transcript fallback 均保留。
- 成功路径最终只存在一个 ID，不出现 duplicate History row。
- Retranscribe 的 STT 成功、LLM 失败场景仍保存 raw checkpoint。
- 失败录音也触发既有 20 条音频 retention。
- Incognito、Agent voice、显式 Cancel 不因本 change 新增 History 记录。
- TypeScript build/tests 与 Rust check/tests 全部通过。

### 用户验收

1. 使用无效 API Key 完成一次正常 Dictation：History 立即存在可播放录音，修正 Key 后可 Retranscribe。
2. 在 STT 成功后模拟润色失败：History 至少显示 STT 原文，音频可播放。
3. 在初始音频与 History checkpoint 完成后强制退出应用：重启后记录仍可见并可重试。
4. 正常 Dictation、Local Whisper、BYOK、Dictionary、Writing Styles、快捷键、文本注入等既有行为没有回归。

## Non-goals

- 自动重试、后台任务队列或启动后自动 resume；
- 新增 Recording/Job/Artifact 数据模型；
- 修改 20 条音频 retention 数量或规则；
- orphan WAV 自动恢复；
- 修改 Incognito、Agent voice 或 Cancel 语义；
- 胶囊录音计时与 Saving/Transcribing/Refining 阶段提示（独立 change）；
- 清理 provider、商业死代码或 updater。

## Terminology

- **持久化检查点（durable checkpoint）**：数据已经写入本地文件/数据库，应用退出后仍可重新加载的阶段。
- **raw transcript**：STT 直接生成、尚未经过 Writing Style / LLM 润色的文本。
- **History 记录**：当前历史页面使用的 `Transcription` 实体；音频文件本身不是独立 UI 实体。
