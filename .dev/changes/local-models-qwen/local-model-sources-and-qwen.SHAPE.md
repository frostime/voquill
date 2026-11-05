---
status: locked
---

# 本地模型：下载源、模型目录与 Qwen3-ASR 内置

> 本文件是 R1 实现前锁定的改动形状，保留用于解释首轮设计。审查后用户已选择“保存模型文件夹后强制自动重启”和“模型仅主动下载”；下文的运行中目录重置与隐式模型准备不再是当前方案。当前行为以 `local-model-sources-and-qwen.SPEC.md` 为准，R2 实施与证据见 `local-models-qwen.PLAN.md`。

## Change

两个彼此独立、风险差别很大的部分被放进同一个 change，因为它们共享同一条数据通路，且顺序不可颠倒：

- **Phase 1（下载与目录）**：模型候选源排序、按序回退、字节数核对、模型目录可配。不动推理引擎，Whisper 立刻受益。
- **Phase 2（Qwen 内置）**：sidecar 增加 transcribe.cpp 引擎，按模型家族路由；Whisper 继续走 whisper-rs。Qwen3-ASR 0.6B（Q8_0 GGUF，850 MB）成为一个内置模型条目。

拆成两阶段而不是一个大 diff，是因为 Phase 1 的验证（干净网络下能下完、能换盘）与 Phase 2 的验证（模型能跑、输出正确）互不依赖，前者失败时后者不该被牵连。

## 为什么是这个组织

分界线选在"模型家族"而不是"模型条目"：transcribe.cpp 与 whisper-rs 是两套互不兼容的运行时（GGUF 融合格式 vs whisper.cpp GGML），把 Qwen 硬塞进现有 `WhisperContext` 路径不可能；反过来把 Whisper 迁到 transcribe.cpp 会改动用户已经在用的行为，并失去 `hindi2hinglish` 这个 GGML 微调模型。因此引擎隔离在 sidecar 内部、由模型标识决定，HTTP 契约不变——TS 侧只多一个模型 slug，不知道有两个引擎。

下载侧的分界线选在"sidecar 拥有源列表、TS 拥有偏好顺序"：URL 与字节数是模型知识，只能有一份（Rust）；用户偏好是应用状态，只能有一份（TS/SQLite）。

## A. Spatial Diff Tree

### Phase 1：下载源顺序 + 模型目录

```text
packages/rust_transcription/src/
├── models.rs        modify  +35–55/-10–20   local edit
│     role  单一来源：候选源列表（镜像/官方）、期望字节数；env 覆盖仍为硬覆盖
├── downloads.rs     modify  +30–55/-10–25   moderate reorganization
│     role  start_or_get_active 接收候选源列表；按序尝试；成功后核对字节数；
│           失败仍删除临时文件（行为不变）
└── api.rs           modify  +6–14/-2–6      local edit
      role  POST /v1/models/:model/download 接受可选 preferMirror

apps/desktop/src-tauri/src/
├── db/migrations/070_model_storage_prefs.sql  create  +2–4   additive
│     role  user_preferences 增加 models_dir TEXT / model_download_source TEXT
├── db/mod.rs                     modify  +4–8   additive
├── db/preferences_queries.rs     modify  +10–20/-2–8   mechanical
│     role  INSERT 列、ON CONFLICT SET、SELECT 列
└── domain/preferences.rs         modify  +4–8   additive (两个 Option<String>)

packages/types/src/preferences.types.ts  modify  +2–4   additive public type

apps/desktop/src/
├── state/settings.state.ts                  modify  +4–10      additive
├── actions/user.actions.ts                  modify  +20–40     local edit
│     role  setPreferredTranscriptionModelsDir / setModelDownloadSource + persist
├── utils/ai.utils.ts                        modify  +4–10      mechanical（apply 到 state）
├── repos/preferences.repo.ts                modify  +2–6       mechanical（字段透传）
├── sidecars/index.ts                        modify  +25–45     local edit
│     role  模型管理（下载/删除/状态）固定走 CPU 侧车；目录切换时统一重置两个实例
├── sidecars/local-transcription.sidecar.ts  modify  +25–45/-4–12  local edit
│     role  resolveModelsDir() 读偏好；downloadModel() 传 preferMirror；
│           新增 resetModelsDir()：清 modelsDirPromise / readyModels，并等待进行中的启动
└── components/settings/AITranscriptionConfiguration.tsx  modify  +45–85/-5–15  local edit
      role  “下载源”下拉（两档）+“模型目录”路径输入（占位显示默认值）

新增测试（位置沿用 desktop 现有 vitest 布局）  create  grouped +30–70
      role  源排序与回退、字节数不符时切源、目录偏好解析；现有 util 测试不动

CHANGELOG.md  modify  +2–4（[Unreleased] Added）
```

### Phase 2：Qwen3-ASR 内置

```text
packages/rust_transcription/
├── Cargo.toml        modify  +1–2            additive
│     role  新增 libloading（不引入 C++/CMake 依赖）
├── src/transcribe_dll.rs create  +180–320    additive（新模块）
│     role  加载 transcribe.dll 并声明所需 C ABI：
│           model_load_file / model_free / session_create / session_free /
│           run / full_text / session_get_limits / device_count / device_get_info
├── src/qwen.rs       create  +60–120         additive
│     role  在 DLL 之上提供 validate() 与 transcribe()；按路径缓存 model+session；
│           把 pcm / 语言 / prompt 映射进 transcribe_run_params
├── src/models.rs     modify  +25–45          local edit
│     role  家族判定（Whisper | Qwen）、Qwen artifact 登记（文件名/字节/源/revision）
├── src/transcription.rs modify  +10–25       local edit
│     role  只加家族分支；whisper 的设备解析与实现不动
├── src/state.rs      modify  +12–25          local edit
│     role  持有 qwen 引擎与 DLL 目录（来自 env）
├── src/api.rs        modify  +20–45          local edit
│     role  转写、session finalize、状态查询按家族分派；区分“未下载”与“引擎加载失败”
├── src/streaming_sessions.rs  modify  +4–10  mechanical
│     role  已有模型标识，只补 vocabulary/prompt 等新字段
└── tests/sidecar_integration.rs  modify  +25–55  additive
      role  Qwen e2e（需下载 850 MB，默认 #[ignore]）

apps/desktop/
├── scripts/prepare-sidecars.mjs        modify  +25–45  local edit
│     role  幂等下载并解压 transcribe-native-0.4.1-windows-x86_64-cpu-vulkan.tar.gz
│           到 src-tauri/resources/transcribe/
├── src-tauri/tauri.conf.json           modify  +2–4    additive
│     role  bundle.resources 增加 resources/transcribe/**
├── src-tauri/.gitignore                modify  +1      additive（不提交约 55 MB DLL）
├── src/sidecars/local-transcription.sidecar.ts  modify  +8–16  local edit
│     role  spawn env 注入 RUST_TRANSCRIPTION_NATIVE_DIR（资源目录绝对路径）；
│           本地模型选中时取消 60 s 空闲销毁（否则每次口述多 3.4 s 装载）
├── src/utils/local-transcription.utils.ts  modify  +2–6  additive（slug + 归一化）
├── src/utils/local-transcription-sidecar.utils.test.ts  modify  +5–12
│     role  模型列表与“未知值回落 tiny”的断言纳入新 slug
└── src/components/settings/AITranscriptionConfiguration.tsx  modify  +8–16  additive
      role  MODEL_OPTIONS 增加 “Qwen3-ASR 0.6B（850 MB）”

不变（有意保持零改动）：
  apps/desktop/src/repos/transcribe-audio.repo.ts   # LocalTranscribeAudioRepo 只传 model slug
  apps/desktop/src-tauri/src/system/models.rs       # 旧 in-process 下载路径，仍无调用者
```

> Phase 2 的形状在 SPIKE 后改变：原方案"引入 transcribe-cpp 并编译 C++"在 MSVC 上实测失败（三次尝试，见 `spike-transcribe-cpp-build.md`）；改为运行时加载上游预编译 DLL（147 个 C ABI 导出，含 Vulkan 后端，不需要 Vulkan SDK 参与构建）。因此 CMake 不再参与 sidecar 构建，`gpu-vulkan` 特性也不再与 Qwen 相关。

### Phase 3（必需）：全部本地模型使用独显

```text
packages/rust_transcription/src/
├── transcription.rs   modify  +15–30  设备结构补 device_type（独显 / 核显 / CPU）
└── api.rs             modify  +5–10   设备列表 JSON 增加该字段

apps/desktop/src/
├── utils/local-transcription.utils.ts             modify  +5–10   类型 + “独显才可选”
├── actions/settings-local-transcription.actions.ts modify  +10–20  偏好为空时默认选独显
└── utils/ai.utils.ts                              modify  +5–10   首次应用偏好时同一规则

.github/workflows/gpu-build-test.yml  create  +90–110   构建期验证（已提交）

规则：只把独显作为 GPU 选项（核显不出现）；仅在用户从未选择过设备时默认选独显，已明确选 CPU 的用户不被改写。Whisper 依赖真实构建的显卡版 sidecar；Qwen 由 DLL 内的引擎在独显中自行选择。二者不得出现"一个用显卡、一个用 CPU"的混合状态。

## B. Call & Dependency Shift

```text
apps/desktop/src/components/settings/AITranscriptionConfiguration.tsx :: handleDownloadModel()
└── apps/desktop/src/sidecars/local-transcription.sidecar.ts :: downloadModel()
    ├── ... (ensureStarted / health poll / 进度轮询 pass-through) ...
    ├── [MOD] POST /v1/models/:model/download        # + {preferMirror}
    │    └── packages/rust_transcription/src/api.rs :: download_model()
    │        └── [MOD] downloads.rs :: start_or_get_active()   # 候选源循环 + 字节数核对
    └── [KEEP] GET /v1/models/:model/download/:job_id          # 进度快照不变

apps/desktop/src/sidecars/index.ts :: LocalTranscriptionSidecarFacade
└── [MOD] 模型管理统一走 CPU 侧车；setModelsDir() 统筹两个实例的重置

apps/desktop/src/sidecars/local-transcription.sidecar.ts :: buildSpawnEnv()
├── [MOD] resolveModelsDir()      # 偏好目录优先，默认 appDataDir()/transcription-models
└── [NEW] RUST_TRANSCRIPTION_NATIVE_DIR   # 预编译 DLL 目录

packages/rust_transcription/src/api.rs :: finalize_transcription_session()
└── [NEW] state::engine_for(model)
    ├── [KEEP] transcription.rs :: TranscriptionEngine   # whisper-rs，内部逻辑不动
    └── [NEW]  qwen.rs :: QwenEngine                     # 经 transcribe_dll.rs 调用 transcribe.dll
```

## C. Key Boundary Sketch

```rust
// packages/rust_transcription/src/models.rs
pub enum ModelFamily { Whisper, Qwen }        // [NEW]

impl WhisperModel {                            // 现有名字；Phase 2 建议改名 LocalModel
    pub fn family(self) -> ModelFamily;                    // [NEW]
    pub fn download_sources(self) -> Vec<String>;          // [NEW] 镜像/官方候选（env 覆盖优先）
    pub fn expected_bytes(self) -> Option<u64>;            // [NEW] 下载成功判定
}
```

```rust
// packages/rust_transcription/src/transcribe_dll.rs
pub struct TranscribeLib { /* libloading::Library + 函数指针表 */ }   // [NEW]
impl TranscribeLib {
    pub fn load(native_dir: &Path) -> Result<Self, String>;            // 加载 transcribe.dll
    pub fn model_load_file(&self, path: &Path) -> Result<Model, String>;
    pub fn run(&self, model: &Model, pcm: &[f32], req: &QwenRequest) -> Result<QwenOutput, String>;
}

// packages/rust_transcription/src/qwen.rs
pub struct QwenEngine { /* path -> (Model, Session) 缓存；删除/替换模型时失效 */ }   // [NEW]
impl QwenEngine {
    pub fn new(lib: TranscribeLib, mode: ComputeMode) -> Self;
    pub fn validate(&self, path: &Path) -> Result<bool, String>;
    pub fn transcribe(&self, path: &Path, pcm: &[f32], req: &QwenRequest) -> Result<QwenOutput, String>;
}
pub struct QwenRequest { pub prompt: Option<String>, pub language: Option<String> }   // 无 vocabulary
pub struct QwenOutput { pub text: String, pub inference_device: String }
```

```ts
// apps/desktop/src/sidecars/local-transcription.sidecar.ts（契约，不新增抽象）
downloadModel({ model, preferGpu, preferMirror, onProgress })   // [MOD] 只加一个布尔
```

## Implementation Guardrails

1. **Whisper 输出必须逐字不变**：`transcription.rs` 里的 whisper 路径只允许被"路由"包一层，不重写参数、不改分段、不改 `initialPrompt` 组装。
2. **模型知识只有一份**：TS 不得出现下载 URL 或校验用的精确字节数；UI 里的 "850 MB" 只是展示文案。
3. **不静默回落**：镜像失败不得改用官方之外的任何"默认值"；Qwen 加载失败不得改用 Whisper；模型缺失时返回既有 `model_not_downloaded` 语义。
4. **Qwen 的校验不能每次设置页刷新都重载 850 MB**：与 whisper 的 context 缓存同构，按路径缓存 session。
5. **不引入 C++ 构建**：Qwen 只通过 `libloading` 加载上游预编译 DLL；`transcribe-cpp` / CMake / Vulkan SDK 都不得成为 sidecar 的构建前提。
6. **DLL 加载顺序固定**：必须先调用 `transcribe_init_backends(<dll 目录>)` 再装载任何模型（该预编译包是 dynamic-backend 构建，只在包内搜索），并保证 `ggml*.dll` 能被找到（PATH 或 `AddDllDirectory`）；否则设备数为 0、模型加载报 `failed to initialize CPU backend`（已实测）。
7. **装载成本不得落到每次口述**：本地模型选中时 sidecar 不得按 60 秒空闲销毁；如需销毁，必须在下次口述前预热。实测 GPU 装载 3.4 秒。
8. **下载回退期间任务不得进入终态**：`Failed` 只在全部源失败后发布；前端靠轮询任务状态驱动，提前终结会让回退无法被观察到。
9. **目录切换只在 facade 完成**：任何模块不得直接改写单个 sidecar 的 models 目录字段；切换必须重置两个实例并等待进行中的启动。
10. **改名是一次机械动作**：`WhisperModel` → `LocalModel` 涉及 6 个文件 31 处引用，只在 Phase 2 内做，且不改变任何行为；不做额外的模块重整。

## Blockers（为什么 SHAPE 仍是 draft）

1. **DLL 运行时行为未验证**（原"能否构建 C++ 依赖"已被实测否定）：见 `spike-transcribe-cpp-build.md`。crates.io 0.4.1、hex 所钉 rev 与 main 三个版本在本机 MSVC 上均编译失败，因此 Phase 2 改为加载上游预编译 `transcribe.dll`（147 个 C ABI 导出，自带 Vulkan/CPU 后端）。仍未验证的是：DLL 能被 `libloading` 加载、能枚举到 GTX 1050 Ti、能在 850 MB 模型上跑通一条真实录音。
   → 下一步：下载 `Qwen3-ASR-0.6B-Q8_0.gguf`（hf-mirror，约 850 MB），用最小 FFI 探针跑通 `load → run → full_text`，并记录耗时与设备。
2. **速度基线未知**：当前 GPU 侧车是 CPU 二进制拷贝，Qwen 在 1050 Ti 上的实际吞吐没有实测数据；任何"亚秒级"说法都只是按 transcribe.cpp 公开基准外推的估计，不作为验收标准。
3. **词典经 prompt 的副作用未验证**：改为只经 `initialPrompt` 注入后，0.6B 是否把词表念进输出需要在真机音频上确认。
