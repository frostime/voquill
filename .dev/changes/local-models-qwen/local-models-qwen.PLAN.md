# 实施进度（本地模型：下载源 / 模型目录 / Qwen3-ASR / 默认独显）

分支：`feat/local-models-qwen`（`main` 未改动）。契约见 `local-model-sources-and-qwen.SPEC.md`（目标与验收）与 `...SHAPE.md`（已锁定，不再修改）。

## Phase 1：下载源与模型目录 —— 已实现，待界面实测

已完成：

1. `packages/rust_transcription/src/models.rs`：每个模型给出镜像/官方两个候选 URL（`download_sources`）、登记字节数（`expected_bytes`），环境变量覆盖仍是硬覆盖。
2. `downloads.rs`：同一任务内按序尝试候选源；只有全部失败才标记 `failed`；远端失败（连接、状态码、流中断、字节数不符）才换源，本地落盘失败直接报错；已存在文件也必须匹配登记字节数。
3. `state.rs`：HTTP 客户端加连接 10 秒 / 读取 30 秒超时（否则被墙的源会永久挂住）。
4. `api.rs`：下载接口接受 `{ preferMirror }`；有环境覆盖时跳过字节校验（自定义权重大小未知）。
5. 偏好：migration `070_local_model_preferences.sql` 增加 `models_dir` / `model_download_source`；Rust 域结构、SQL 映射、TS 类型与仓库映射同步。
6. TS：sidecar 从偏好读取模型目录与下载源；facade 的模型管理统一走 CPU 侧车；切换目录会重置两个实例并拒绝在下载进行中切换；设置页新增"下载源"下拉与"模型目录"输入框。

验证：

- `cargo test -p rust_transcription --lib`：8 项通过（含候选源排序、字节数登记值）。
- `cargo check`（desktop crate）：通过。
- CI `verify-local-models`：desktop `tsc --noEmit`、`oxlint`、单元测试与 sidecar 测试全部通过。
- sidecar 真机端到端：无任何代理环境变量，`{preferMirror:true}` 下载 tiny 成功，落盘 77,691,713 字节；把源指向不可达地址时任务 `failed` 且错误里带源 URL（不静默）。

未验证（需要构建安装包后在真机点一遍）：

- 设置页两个新控件的交互（保存、重启后保留、下载中禁止改目录）。
- migration 070 在既有数据库上的实际迁移。

## Phase 2：Qwen3-ASR 内置 —— 已实现，CPU/GPU 均跑通

实现：

1. `models.rs`：`WhisperModel` → `LocalModel` 改名（含 TS 侧 `LocalModelId` / `LOCAL_MODELS`），新增 `qwen3-asr-0.6b` 与 `family()`；Qwen 的仓库路径钉在 `e4e16599…`，字节数 `850423456`。
2. `transcribe_dll.rs`（新）：`libloading` 加载 `transcribe.dll`，先 `transcribe_init_backends(<目录>)` 再把该目录加入 DLL 搜索路径；封装 model/session 生命周期（Drop 里释放）、CPU 设备选择、`run` 与设备名。
3. `qwen.rs`（新）：按路径缓存已加载模型，复用 whisper 的 16 kHz 重采样；语言与 `initialPrompt` 映射进 `transcribe_run_params`。
4. `api.rs`：按 `family()` 分派转写与模型校验；同时修掉了"任何含 model+failed 的错误都报成 model_not_downloaded"的错误映射。
5. 打包：`prepare-sidecars.mjs` 幂等下载并解压上游预编译包到 `src-tauri/resources/transcribe/`（失败只告警），`tauri.conf.json` 增加该资源；sidecar 通过 `RUST_TRANSCRIPTION_NATIVE_DIR` 获得路径。
6. 本地模型不再按 60 秒空闲销毁，避免每次口述多付 3.4 秒装载。

验证：

- Rust：9 项单元测试通过（含家族映射、Qwen 字节数）。
- CI `verify-local-models`：tsc + oxlint + 单测 + Rust 测试全绿。
- CPU 端到端（sidecar 真机、debug 构建）：session → chunks → finalize 返回正确中文，设备 `Intel … (cpu)`。
- GPU 端到端（CI 产出的 release GPU 侧车，下载到本机运行）：`/v1/devices` 报 `NVIDIA GeForce GTX 1050 Ti (Vulkan)`；同一段 8.3 秒音频首跑 8.2 秒（含装载与预热），30.6 秒音频 2.1 秒（14.2× 实时），文本与直接调 DLL 的结果一致。
- 打包步骤在本机实测：`resources/transcribe/` 得到 15 个文件（含 `transcribe.dll`、`ggml-vulkan.dll`）。

已知行为：首个口述会包含模型装载与着色器预热（8.3 秒音频约 8 秒），之后同一进程内为稳态速度。

## Phase 3：全部本地模型用独显 —— 已实现，等待安装包实测

实现：

1. `transcribe_dll.rs`：Qwen 在 GPU 模式下**显式挑选 `device_type == GPU`（独显）**的设备，不再让运行时自由选择；找不到独显就报错（而不是退回核显）。
2. 用户从未选择过设备时默认选独显：新增 `deviceChosen` 状态（来自 `transcriptionDevice != null`），`resolvePreferredDevice` 在未选择时优先第一个 GPU 设备；用户明确选过 CPU 则保持不动。
3. 新增 `build-installer-test` 工作流（手动/分支触发）：装 Vulkan SDK → 构建显卡版 sidecar → 打包安装包 → 校验 GPU 二进制与 CPU 二进制不同、`resources/transcribe/transcribe.dll` 已打包。

与 SHAPE 的偏差（有证据的缩减）：原计划给 `/v1/devices` 增加 `device_type` 字段并在应用侧过滤核显。实测 CI 产出的显卡版 sidecar 只枚举到 `NVIDIA GeForce GTX 1050 Ti (Vulkan)`，Intel UHD 630 并未出现——whisper 的设备枚举本来就只挑 `GGML_BACKEND_DEVICE_TYPE_GPU`。因此**不需要**新增字段；"GPU 只算独显"在 Whisper 路径已成立，Qwen 路径由上面第 1 点保证。

验证：

- Rust 单测与 CI `verify-local-models` 全绿（含 Qwen 独显选择逻辑编译）。
- 待验证（需要安装）：安装包内设备下拉是否出现 1050 Ti、Whisper 是否跑在该显卡上、Qwen 首次口述与后续口述的耗时。

## 环境备注

- 本机 `node_modules` 的工作区软链指向 `/h/...`（MSYS 路径），Windows 上的 `tsc`/`node` 无法解析，`pnpm install` 也因文件占用报 UNKNOWN。因此 TS 校验走 CI；需要本地构建时先清理 `node_modules` 再 `pnpm install`。
- 本机未安装 Vulkan SDK；显卡版 sidecar 通过 CI 构建后下载（`gpu-build-test` 工作流）。
