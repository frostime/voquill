# 实施进度（本地模型：下载源 / 模型目录 / Qwen3-ASR / 默认独显）

产品分支：`feat/local-models-qwen`（`main` 未改动）。R2 审查修正的检查点为 `51907548`，开发基线为 `89f023d9`。R3 将这些修正与 10.1.0 版本准备纳入产品分支构建安装测试包。当前契约见 `local-model-sources-and-qwen.SPEC.md`；SHAPE 和 R1 handover 是首轮实现记录，其中运行中更换目录的方案已被本轮确认的强制重启方案取代。

## Mainline

- R1 基线：下载源、目录偏好、Qwen DLL 与独显默认已实现；下文 Phase 1–3 保留当时的验证证据，不代表修正后的验收。
- R2 审查修正：已实现资源查找修正、仅主动下载、保存模型文件夹后自动重启、Qwen 同模型计算串行化。
- R2 客观验证：TS 单测、类型/静态检查、Rust 单测及集成测试通过；真实安装包 DLL 与应用生成的资源路径已隔离验证，Qwen CPU 转写通过。
- R3 安装基线（`8e8e7aff`）：[安装包构建](https://github.com/frostime/voquill/actions/runs/42037110853)与[校验](https://github.com/frostime/voquill/actions/runs/42037110978)成功；332 TS tests、10 Rust tests、类型/静态检查通过。包内 Whisper/Qwen 均使用 GTX 1050 Ti 转写成功；安装界面确认/取消、保存目录后重启已实测。原 API 模式、CPU 选择及默认模型目录已恢复。
- R4 升级阻塞修正 [I7]：固定旧版迁移的实际换行格式，重新构建并验证旧库启动。<< CURRENT。缺模型行为采用 R2 自动化证据，不追加界面自动化。
- 发布准备：R4 通过后整理版本日志，用户决定合入 main 与创建正式 Release。

## Current Phase

本阶段只解决 [I7]。原始 `10.0.4-beta.1` 数据库的前 68 条迁移校验匹配 CRLF，第 69 条匹配 LF。`.gitattributes` 固定这些已发布字节，不引入数据库自动修复或兼容分支。

顺序：提交换行配置，使用现有显卡工作流重新构建；以原始备份中的迁移记录验证新包启动和迁移 70，核对现有数据保留。上一轮为继续验收在现用库中把第 69 条校验临时改成 CRLF，最终需恢复成备份的 LF 值，以匹配新包。用户已授权备份、覆盖安装及该记录修复。不读取或展示密钥字段。

退出条件：新包在旧迁移记录上启动成功，迁移 70 生效，历史和偏好保留；停止追加验收。Whisper/Qwen 显卡和目录重启沿用 R3 实测，缺模型不下载沿用 R2 测试。

Now: 已从原始备份核对前 68 条 CRLF、第 69 条 LF；此前统一 CRLF 的暂存方案无效，已改为按旧版格式固定。等待提交及构建。

### R3 构建约束

使用 `.github/workflows/build-installer-test.yml`，由 GitHub 的 Windows runner 安装 Vulkan SDK，且 `VOQUILL_REQUIRE_GPU_SIDECAR=true`，禁止用 CPU 程序冒充显卡程序。本机不安装 SDK，也不依赖主工作区损坏的 node_modules。必须构建包含 R2 修正与 10.1.0 版本的最新提交；已有 10.0.4 安装包只用于历史验证，不能发布。

### R2 验证证据

- Rust：`cargo test --offline --manifest-path packages/rust_transcription/Cargo.toml --lib`，10 passed；`--test sidecar_integration`，6 passed、1 ignored。日志 `tmp/R2-cargo-test.log`、`tmp/R2-cargo-integration.log`。
- Qwen 并发回归测试使用假的 C 计算入口记录同时运行数，但执行真实 `TranscribeDll::run`。在临时模块副本中去掉生产互斥后，测试观察到并发数 2 并失败；保留互斥时为 1 并通过。日志 `tmp/R2-qwen-compute-probe-{pass,mutant}.log`，未修改生产源文件进行反向验证。
- TS：隔离 worktree `.worktrees/261105_local-models-review-checks` 的 desktop 单测 23 files / 332 passed；desktop 自己锁定的 TypeScript 5.8.3 `--noEmit` 通过；oxlint 0 warnings / 0 errors。日志在该 worktree 的 `tmp/R2-{vitest,typescript,oxlint}.log`。
- TS 反向验证：仅在隔离 worktree 恢复 `89f023d9` 的 `local-transcription.sidecar.ts`，新测试 6 failed / 1 passed；恢复修正后 7 passed。日志 `tmp/R2-vitest-{r1-red,restored-green}.log`。主工作区未回退。
- 安装资源：从已有 `tmp/installer/nsis/Voquill_10.0.4_x64-setup.exe` 只提取 `resources/transcribe/*`。运行真实 TS `buildSpawnEnv`（用隔离目录替代 Tauri 的资源根目录）能找到提取出的 `transcribe.dll`。用该环境启动更新后的 CPU 后台程序，仓库公开音频 `packages/rust_transcription/assets/test.wav` 转写为 `Test.`，两个同时 finalize 的会话文本一致。结果 `tmp/R2-bundled-qwen-e2e-result.json`；这不是安装版 UI 重启或 GPU 性能验收。
- Tauri 源码核对：`tauri-plugin-process` 的 restart 调用 `request_restart`，会发送 Exit 事件；已注册的 `tauri-plugin-shell` 在 Exit 时终止它持有的子进程。未在现用应用上调用重启。
- 独立静态复核未发现本轮锁定范围内的可证实问题。

## Issues

- I1 · Qwen DLL 查找漏掉 `resources/`：done。应用查找路径已与实际安装包内容核对，隔离运行成功。
- I2 · 同模型计算重叠违反第三方库契约：done。`Model` 拥有计算互斥，测试已证明去掉保护会检出并发数 2。
- I3 · 运行中更换目录要求过重：done。用户选择保存后自动重启；单测通过，R3 已实测取消不保存、确认后保存并重启。
- I4 · 录音触发自动下载造成双下载入口：done。两处隐式下载已删除，新测试覆盖缺失、加载失败、已准备模型后来被删除，以及设置主动下载仍可用。
- I5 · 路径输入不确定：done。采用 Tauri 的完整路径判断，空值使用默认，不猜位置；拒绝与保存失败均不触发重启。
- I6 · 删除后旧模型缓存：deferred。用户接受删除、重下后重启，本轮不修、不强制删除后重启。

### I7 · 旧版数据库迁移校验因换行格式不同而拒绝启动

Status: in progress。原始备份 `tmp/R3-backup-10.0.4-beta.1-20261105_221851/roaming/voquill.db` 保留未修改的迁移记录；第 69 条 SQL 内容未变，原始 LF 校验与候选包 CRLF 不同。备份只在本机，不上传。

Resolution: `.gitattributes` 保留旧格式并重新构建；以原始迁移记录运行新包，实际启动并完成迁移 70，现有记录保留。仅比较源码及校验不代表已经验证安装启动。

## R1 实现与历史证据

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

- 主工作区的 `node_modules` 仍不可用，本轮没有删除或重装。R2 最小探针发现 H: 上新建普通目录 junction 也不能遍历，所以问题不只是不正确的 MSYS 链接文本。隔离 worktree 用锁定依赖的 `--node-linker=hoisted --package-import-method=copy --ignore-scripts` 安装；剩余 workspace junction 由明确的源码/编译输出副本替代，过程脚本为 `tmp/prepare-r2-typescript-checks.py`，旧隔离依赖保留在 `tmp/R2-isolated-dependencies-backup`。先用 packages/types 自己的 TypeScript 5.9.2 生成当前声明，再更新隔离副本，避免使用 R1 前的过期 dist。之后本地 TS 验证通过。不要据旧 handover 直接删除主依赖目录。
- 本机未安装 Vulkan SDK；显卡版 sidecar 通过 CI 构建后下载（`gpu-build-test` 工作流）。
