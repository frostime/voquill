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

## Phase 2：Qwen3-ASR 内置 —— 未开始

路线已在 spike 中确认：`libloading` 加载上游预编译 `transcribe.dll`（147 个 C ABI 导出，自带 Vulkan/CPU 后端），不引入 C++ 构建。要点：

- sidecar 启动时先 `transcribe_init_backends(<dll 目录>)`，并保证 `ggml*.dll` 可被找到；
- 模型登记 `qwen3-asr-0.6b`：`Qwen3-ASR-0.6B-Q8_0.gguf`、`850423456` 字节、`handy-computer/Qwen3-ASR-0.6B-gguf` @ `e4e16599…`；
- 参数只映射语言与 `initialPrompt`（字典不单独传 vocabulary）；
- 本地模型选中时取消 sidecar 的空闲销毁，避免每次口述多 3.4 秒装载。

## Phase 3：全部本地模型用独显 —— 未开始

设备接口补 `device_type`（独显/核显/CPU），只把独显作为 GPU 选项；用户从未选择过设备时默认选独显；Whisper 的显卡版由 CI 构建（`gpu-build-test` 已验证可产出：CPU 12.4 MB / GPU 68.0 MB，且本机 `/v1/devices` 能枚举到 GTX 1050 Ti）。

## 环境备注

- 本机 `node_modules` 的工作区软链指向 `/h/...`（MSYS 路径），Windows 上的 `tsc`/`node` 无法解析，`pnpm install` 也因文件占用报 UNKNOWN。因此 TS 校验走 CI；需要本地构建时先清理 `node_modules` 再 `pnpm install`。
- 本机未安装 Vulkan SDK；显卡版 sidecar 通过 CI 构建后下载（`gpu-build-test` 工作流）。
