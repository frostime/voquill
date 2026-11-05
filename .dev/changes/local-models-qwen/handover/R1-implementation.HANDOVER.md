# R1 — 本地模型（下载源 / 模型目录 / Qwen3-ASR / 默认独显）实现交接

分支 `feat/local-models-qwen`（基于 `main` @ `0a488d9a` 之前的 `9daca6fb`），18 个提交，40 个文件，+2140/−260。`main` 未改动。

本文档面向**审查者**：说明这次改了什么、证据在哪、哪些点需要重点判断。契约与决策不在本文重复，见下列权威文件。

## 权威文件

| 文件 | 作用 |
|---|---|
| `.dev/changes/local-models-qwen/local-model-sources-and-qwen.SPEC.md` | 目标、验收、约束（含"GPU 只算独显"） |
| `.dev/changes/local-models-qwen/local-model-sources-and-qwen.SHAPE.md` | 已锁定（`status: locked`）的改动形状与护栏 |
| `.dev/changes/local-models-qwen/local-models-qwen.PLAN.md` | 三阶段实施状态、验证证据、与 SHAPE 的偏差 |
| `.dev/changes/local-models-qwen/spike-transcribe-cpp-build.md` | 两个 spike：MSVC 编译失败、DLL 路线跑通与性能数据 |
| `CHANGELOG.md` `[Unreleased]` | 用户可见变更 |
| `.dev/docs/upstream-divergence.md` 第四节 | 本仓库新增功能索引（已加一行） |

## 改动地图

### 1) sidecar 下载层（Rust）

`packages/rust_transcription/src/{models.rs,downloads.rs,api.rs,state.rs}`

- `LocalModel`（原 `WhisperModel`）：新增 `family()`、`expected_bytes()`、`download_sources(prefer_mirror)`、`url_override()`；仓库路径与镜像同源派生，避免两处维护 URL。
- `downloads.rs`：`start_or_get_active` 接受候选源列表与期望字节数；`run_download_job` 在同一任务内按序尝试；自定义 `DownloadAttemptError::{Remote,Local}` 区分"换源"与"直接失败"；重命名前 `drop(file)`（Windows 必须先关句柄）；已存在文件也核对大小。
- `api.rs`：下载接口接受 `{ preferMirror }`；`Option<Json<_>>` 保证旧的空 body 调用仍可用；按 `family()` 分派转写与校验；修掉"任何含 model+failed 的错误都报 `model_not_downloaded`"的映射。
- `state.rs`：HTTP 客户端 10 秒连接 / 30 秒读取超时。

### 2) Qwen 运行时（Rust，新增）

- `src/transcribe_dll.rs`（+459）：`libloading` 加载 `transcribe.dll`；**必须先 `transcribe_init_backends(<目录>)`**，并把该目录加入 `PATH`（`add_dll_search_path`）以便 `ggml*.dll` 可解析；`Model`/`Session` 用 Drop 释放；CPU 模式挑 `kind == "cpu"`，GPU 模式挑 `device_type == 1`（独显），找不到即报错。
- `src/qwen.rs`（+126）：按路径缓存 `Arc<Model>`；复用 `transcription::resample_to_16khz`；语言（`auto` 不传）与 `initialPrompt` 映射进 `transcribe_run_params`（**不使用** `vocabulary`）。
- `Cargo.toml`：新增 `libloading = "0.8"`；不引入 `transcribe-cpp` 或任何 C++ 构建。

### 3) 偏好与持久化

- `db/migrations/070_local_model_preferences.sql`：`models_dir TEXT`、`model_download_source TEXT`（可空）。
- `db/mod.rs`（注册）、`db/preferences_queries.rs`（INSERT 40/41 号占位符、ON CONFLICT、SELECT、行映射）、`domain/preferences.rs`、`packages/types/src/preferences.types.ts`（新增 `ModelDownloadSource`）。

### 4) 设置与 sidecar 生命周期（TS）

- `sidecars/local-transcription.sidecar.ts`：`resolveModelsDir()` 优先读偏好；下载请求带 `preferMirror`；新增 `resetModelsDir()`（清缓存 + dispose）；`buildSpawnEnv` 增加 `RUST_TRANSCRIPTION_NATIVE_DIR`（来自 `resolveResource("transcribe")`）；**移除 `idleDisposeMs`**（本地进程常驻）。
- `sidecars/index.ts`：模型管理（状态/下载/删除）固定走 CPU 侧车；新增 `resetModelsDir()` 重置两个实例并清 `gpuUnavailable`。
- `actions/user.actions.ts`：`setPreferredModelsDir`、`setModelDownloadSource`；`setPreferredTranscriptionDevice` 标记 `deviceChosen`。
- `actions/settings-local-transcription.actions.ts`：`resolvePreferredDevice` 增加"未选择过设备时优先独显"。
- `utils/*`：`LocalWhisperModel` → `LocalModelId`、`LOCAL_WHISPER_MODELS` → `LOCAL_MODELS`、`normalizeLocalWhisperModel` → `normalizeLocalModelId`，新增 `qwen3-asr-0.6b`。
- `components/settings/AITranscriptionConfiguration.tsx`：新增"下载源"下拉、"模型目录"输入（下载中禁用）、Qwen 模型条目。

### 5) 打包与 CI

- `apps/desktop/scripts/prepare-sidecars.mjs`：幂等下载并解压上游 `transcribe-native-0.4.1-windows-x86_64-cpu-vulkan.tar.gz` 到 `src-tauri/resources/transcribe/`（失败只告警）；用 `%SystemRoot%\System32\tar.exe`（MSYS GNU tar 会把 `C:\` 当远端主机）。
- `src-tauri/tauri.conf.json`：`resources` 增加 `resources/transcribe/*`。
- 新增三个工作流：`gpu-build-test.yml`（手动；CI 里装 Vulkan SDK 构建显卡版 sidecar）、`verify-local-models.yml`（分支推送；tsc + oxlint + 单测 + Rust 测试）、`build-installer-test.yml`（手动/分支推送 + paths 过滤；打完整安装包并校验 GPU 二进制与 runtime 资源）。**均为测试用途，合并前应收尾**。

## 验证证据

| 项 | 命令 / 方式 | 结果 |
|---|---|---|
| Rust 单测 | `cargo test --manifest-path packages/rust_transcription/Cargo.toml --lib` | 9 passed（含家族映射、Qwen 字节数、候选源顺序） |
| desktop Rust | `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | 通过 |
| TS | CI `verify-local-models`（tsc / oxlint / vitest） | 全绿 |
| 下载（真机、无代理 env） | sidecar `POST /v1/models/tiny/download {preferMirror:true}` | 完成，落盘 77,691,713 字节 |
| 下载失败 | 源指向 `http://127.0.0.1:9/...` | `failed`，错误含源 URL |
| Qwen CPU e2e | sidecar session → chunks → finalize（debug 构建） | 文本正确，设备 `Intel … (cpu)` |
| Qwen GPU e2e | CI release GPU 侧车 + 上游 DLL | 设备 `NVIDIA GeForce GTX 1050 Ti (Vulkan)`；30.6 s 音频 2.1 s（14.2×）；8.3 s 首跑 8.2 s（含装载+预热） |
| 安装包 | `build-installer-test` 41981468813 | 成功；`tmp/installer/nsis/Voquill_10.0.4_x64-setup.exe`（88 MB） |

## 审查重点（建议逐条判断）

1. **下载任务状态机**：`run_download_job` 只在全部源失败后才 `mark_failed`；换源时进度归零但 job 保持 `Running`。确认前端轮询（`local-transcription.sidecar.ts` 的 `downloadModelInternal`）不会因中途状态抖动提前退出。
2. **文件安全**：先 `sync_all`、`drop(file)` 再 `remove/rename`（Windows 语义）；失败路径删临时文件；已存在文件大小不符会被删除——确认这是可接受的数据处置。
3. **错误语义**：`map_transcription_error` 现在只在"not downloaded / no such file / os error 2"时映射 404，其余走 500。检查是否还有别的地方把引擎失败误报成"未下载"。
4. **DLL 契约**：`transcribe_dll.rs` 的 `#[repr(C)]` 结构与 `include/transcribe.h`（父目录 `tmp/transcribe.h` 是 0.4.1 快照）逐字段对齐；`device_type == 1` 表示独显来自实测（Intel UHD 630 = 2、CPU = 0）。版本升级需重新核对 `contract.json` 的 `header_hash`。
5. **进程常驻的代价**：去掉 `idleDisposeMs` 后，CPU/GPU 两个 sidecar 在应用运行期间常驻；GPU 侧占用约 1.1 GB 显存（Qwen 权重 + 工作区）。确认这是想要的取舍，以及未被使用的那一个是否值得销毁。
6. **模型管理的单点化**：状态/下载/删除固定走 CPU 侧车；验证 `validate=true` 在 CPU 侧车加载 Qwen（约 300 ms、约 850 MB 内存）不会与 GPU 侧车的推理缓存互相干扰。
7. **偏好写入路径**：`setPreferredModelsDir` 先改 state、再 `resetModelsDir()`、最后持久化；中途失败会留下"内存新值、库旧值"。判断是否需要事务化。
8. **`deviceChosen` 的语义**：首次解析到 GPU 后会被 `setPreferredTranscriptionDevice` 写成显式选择。确认这符合"只在从未选择时默认独显"的本意。
9. **i18n**：新 UI 用了 `FormattedMessage`，但 `MODEL_OPTIONS` 的 label/helper 仍是硬编码英文（既有偏差）；`AITranscriptionConfiguration.tsx` 里新增的一处错误提示字符串未走 i18n。
10. **命名**：`LocalModel`/`LocalModelId` 由 `WhisperModel`/`LocalWhisperModel` 改名而来（31 处 Rust 引用 + 10 个 TS 文件），确认无遗漏的语义错位（例如 `getTranscriptionSupportsStreaming` 对 Qwen 依然返回 false）。
11. **CI 收尾**：三个测试工作流都带 `push` 触发（其中安装包工作流有 paths 过滤）。合并前应改为手动触发或删除。
12. **发布号**：安装包仍为 `10.0.4`（与已发布版同号），正式发版前应在 `apps/desktop/src-tauri/Cargo.toml` 升到 `10.1.0`。

## 已知缺口

- **未在真实安装环境验证**：设备下拉是否出现 1050 Ti、Whisper 是否真的跑在该卡上、migration 070 在既有库上的迁移、改目录后重启的行为。安装包已就绪（`tmp/installer/`），安装会覆盖当前 10.0.4。
- **首次口述成本**：应用启动后第一次用 Qwen 含装载 + 着色器预热（8.3 s 音频约 8 s）；之后的稳态由进程常驻保证。
- **无断点续传**：下载中断即从 0 开始，符合 SPEC 的"不做"。
- **无 Qwen 的自动化 e2e**：需要 850 MB 模型，未加入 CI；`tests/sidecar_integration.rs` 未新增 Qwen 用例。

## 环境坑（复跑前必看）

1. 本机 `node_modules` 的工作区软链指向 `/h/...`（MSYS 路径），Windows 的 `tsc`/`node` 无法解析；`pnpm install` 报 UNKNOWN（文件占用）。**TS 校验一律走 CI**。若需本地构建：删掉 `node_modules` 后重装。
2. `pnpm run lint` 的 `prettier --check` 在本仓库 Windows checkout 上**对所有文件**失败（无 `.gitattributes`/prettier 配置钉住行尾）。CI 里只跑 `oxlint`，这是既有状况，不是本次引入。
3. `packages/rust_transcription` 依赖 CMake（VS 2022 自带 3.29.5，不在 PATH）。Vulkan SDK 本机未安装，显卡版 sidecar 只能在 CI 构建。
4. `transcribe-cpp`（crates.io 0.4.1、hex 所钉 rev、main）在本机 MSVC 19.41 上均编译失败（canary 家族）。这就是改走预编译 DLL 的原因，详见 spike 文档；不要回退到编译路线除非先解决它。
5. 本地 `prepare-sidecars.mjs` 在没有 Vulkan SDK 时会把 GPU 侧车替换成 CPU 拷贝，会覆盖 CI 下载的显卡版。

## 复跑方式

```bash
# sidecar 单测
cargo test --manifest-path packages/rust_transcription/Cargo.toml --lib

# Qwen 端到端（需要 850 MB 模型与 DLL 目录，见 spike 文档）
#   启动 sidecar：RUST_TRANSCRIPTION_NATIVE_DIR=<dll 目录>
#   POST /v1/transcriptions/sessions → 分块 → finalize

# CI
gh workflow run build-installer-test.yml --ref feat/local-models-qwen   # 需先合并到 main 才能手动触发
```

## 后续步骤（按顺序）

1. 安装 `tmp/installer/nsis/Voquill_10.0.4_x64-setup.exe`，按 SPEC 的验收项在真机过一遍（设备、下载、目录、Qwen 与 Whisper 转写）。
2. 版本号升到 `10.1.0`，重打安装包。
3. 收尾 CI（去掉测试工作流的 `push` 触发）。
4. `git merge --no-ff` 合入 `main`；如需发布，按 `.dev/docs/release.md` 打 tag。
