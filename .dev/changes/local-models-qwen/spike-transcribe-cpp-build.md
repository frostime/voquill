# SPIKE：能否在本仓库使用 transcribe.cpp

日期：2026-11-05　状态：结论已出，待决定后续路线

## 要验证的假设

Phase 2 计划把 Qwen3-ASR 走 transcribe.cpp（`transcribe-cpp` Rust 绑定，C++/CMake 编译）。需要确认：这个依赖能否在本机与 `prepare-sidecars.mjs` 的构建链路里编译出来。

## 结果：不能（MSVC 编译失败）

试验用独立 crate（`tmp/qwen-spike`，不触碰仓库代码），`default-features = false`，环境为 VS 2022 Community 的 MSVC 19.41 + CMake 3.29.5。

| 版本 | 结果 |
|---|---|
| crates.io `transcribe-cpp 0.4.1`（当前最新） | ❌ `src/arch/canary/model.cpp`：`extern const Arch arch` 处 C4430/C2146，前置错误是 `run` 重载解析失败（757 / 1590 行） |
| hex 所钉 git rev `2778ae4b` | ❌ 同一处、同样错误 |
| 仓库 `main`（解析到 `5700f127`） | ❌ 换成了另一批错误：`sp_space_id` 未声明、尾随返回类型语法错误（659 / 662 行） |

失败集中在 canary 家族这一个编译单元，三次尝试共耗时约 9 分钟。`cargo build` 在此之前已经成功走通 CMake、MSVC 与 C++ 编译流程（即工具链本身可用），失败原因是该翻译单元与 MSVC 不兼容，不是环境缺件。

## 但找到了更省事的替代路径：上游预编译 Windows DLL

`transcribe.cpp` v0.4.1 的 GitHub Release 提供 Windows 预编译包：

```
transcribe-native-0.4.1-windows-x86_64-cpu-vulkan.tar.gz   (18 MB)
  transcribe.dll
  ggml.dll / ggml-base.dll / ggml-vulkan.dll / ggml-cpu-*.dll (10 个 ISA 变体)
  contract.json  { version, header_hash, backends, lane }
```

实测该 DLL 导出 **147 个 `transcribe_*` C ABI 符号**，与仓库 `include/transcribe.h` 对齐；头文件确认了本变更所需的最小 API 子集都存在：

```c
transcribe_model_load_file(path, params, &model)   // 加载 GGUF
transcribe_model_free(model)
transcribe_session_create(...) / transcribe_session_free(session)
transcribe_run(session, pcm, n_samples, params)    // params 含 language / vocabulary / prompt
transcribe_full_text(session)                      // 取转写文本
transcribe_session_get_limits(session, ...)        // 长度上限
transcribe_device_count() / transcribe_device_get(i) / transcribe_device_get_info(...)
```

因此可以完全不编译 C++：用 `libloading` 在运行时加载 `transcribe.dll`，按头文件声明所需函数签名。Vulkan 后端已包含在该包内（`ggml-vulkan.dll`），不需要 Vulkan SDK；缺 GPU 时该包本身也含 CPU 后端。

## 路线对比

| 路线 | 代价 | 风险 |
|---|---|---|
| **A. 运行时加载上游 DLL（建议）** | 新增 `libloading` 依赖；手写约 10 个 FFI 声明；把 DLL 目录随应用打包（18 MB 压缩 / 约 55 MB 解压） | 需实测 DLL 可加载、可推理；版本升级靠替换 DLL（`contract.json` 有 `header_hash` 可校验） |
| B. 修上游 MSVC 问题或固定已修复 rev | 需上游接受修复，或自己打补丁维护 fork | 时间不可控；本机无法验证 |
| C. clang-cl | 需要给 `transcribe-cpp-sys` 的 CMake generator 打补丁（现在硬编码 `-G "Visual Studio 17 2022"`），并引入 Clang 工具链 | 换编译器不保证通过；本机无 clang-cl |
| D. 换引擎 | 权重格式、参数、质量验证全部重做 | 与本次目标偏离 |

## 尚未验证（下一步）

1. **DLL 能加载并推理**：需要一个 850 MB 的 `Qwen3-ASR-0.6B-Q8_0.gguf`（`handy-computer/Qwen3-ASR-0.6B-gguf`，hf-mirror 直连可下），以及约 30 行 FFI 探针，在一条真实 WAV 上跑通 `load → run → full_text`。
2. **速度与质量**：同一批 WAV 上对比 whisper large-v3-turbo；顺带验证"字典经 prompt 注入是否被念进输出"。
3. **Vulkan 是否真的启用**：本机 `VULKAN_SDK` 缺失只影响编译期；此包自带预编译 Vulkan 后端，但仍需确认运行时能枚举到 GTX 1050 Ti。

## 对计划的影响

Phase 2 的形状从"引入 C++ 依赖并链接"改为"运行时加载预编译 DLL"，因此：不再需要 CMake 参与 sidecar 构建；`prepare-sidecars.mjs` 的角色变成下载/解压该预编译包；`gpu-vulkan` 特性不再用于 Qwen；DLL 目录需要作为应用资源分发，并通过环境变量告知 sidecar 位置。

## 追加验证：DLL 路线跑通（2026-11-05）

在 1050 Ti / i5-8400 / 32 GB 的机器上，用 `libloading` 加载上游预编译包，模型 `Qwen3-ASR-0.6B-Q8_0.gguf`（850,423,456 字节，与登记值一致），音频取自本机 `transcription-audio` 的真实录音（48 kHz 单声道，探针内线性重采样到 16 kHz）。

### 必要的两个前置（都会影响 Phase 2 实现）

1. 该预编译包是 **dynamic-backend 构建**：必须先调用 `transcribe_init_backends(<dll 目录>)`，否则设备列表为 0、模型加载报 `failed to initialize CPU backend`。头文件明确该搜索是严格包内（不看 exe 目录、不看 cwd、不看 PATH）。
2. `transcribe.dll` 的兄弟 DLL（`ggml*.dll`）需要能被子加载器找到：本次通过把该目录加入进程 `PATH` 解决。sidecar 侧必须在 `dlopen` 前做同等处理（PATH 或 `AddDllDirectory`），不能只依赖 `init_backends`。

### 设备与显存

```
devices: 3
  Vulkan0  Intel UHD Graphics 630   vulkan  (iGPU)
  Vulkan1  NVIDIA GeForce GTX 1050 Ti vulkan vram=4218MB free=3617MB
  CPU      Intel i5-8400            cpu
```

Qwen 自动选中 `Vulkan1`（1050 Ti），加载时把 805.3 MiB 权重拷进显存，随后 sched buffer 约 310 MB；加载后剩余显存 2809 MB。

### 速度（Q8_0，语言提示 zh）

| 录音时长 | GPU 1050 Ti（Vulkan） | CPU i5-8400 |
|---|---|---|
| 3.7 s | 501 ms（7.4×） | 1 063 ms（3.5×） |
| 8.3 s | 657 ms（12.6×） | — |
| 30.6 s | 1 855 ms（16.5×） | 7 711 ms（4.0×） |
| 74.7 s | 6 187 ms（12.1×） | — |
| 135.2 s | 7 086 ms（19.1×） | 21 543 ms（6.3×） |

模型装载：GPU 3 436 ms（拷 805 MB 到显存）；CPU 308 ms（mmap）。首次安装后的**第一次**推理额外有约 5 s 的着色器/图编译开销（本次 8.3 s 录音首跑 5 736 ms），之后按进程装载、首个推理不再重复这笔开销。

### 结论

- DLL 路线可用：C ABI 与头文件一致，设备枚举、模型装载、推理、取文本全部跑通，输出为正常中文（含标点）。
- 稳态性能：GPU 约为 12–19× 实时，CPU 3.5–6.3×。在本机 GPU 上，8 s 口述约 0.66 s、30 s 约 1.85 s、2 分钟约 7 s。
- 冷启动成本不能忽略：每次 sidecar 进程重启约 3.4 s 装载。当前 sidecar 空闲 60 s 即销毁，本地模型若沿用该行为，间隔稍长的每次口述都会先等 3.4 s——这需要作为独立行为要求处理（保活或预热），否则"松键很快出字"不成立。

## 追加验证：显卡版 sidecar 已在 CI 构建成功（2026-11-05）

本地没有安装 Vulkan SDK，改为在 GitHub Actions 上构建，避免占用本机磁盘。工作流 `.github/workflows/gpu-build-test.yml`（仅手动/分支触发）：

1. `choco install vulkan-sdk` → 得到 `C:/VulkanSDK/1.4.363.0`，导出 `VULKAN_SDK`；
2. `node scripts/prepare-sidecars.mjs`（`VOQUILL_REQUIRE_GPU_SIDECAR=true`，GPU 构建失败即报错）；
3. 断言两个二进制哈希不同、GPU 版本引用了 `vulkan-1.dll`；
4. 上传两个 sidecar 作为 artifact。

结果：整个 job 约 9 分钟，成功。

| 产物 | 大小 | sha256（节选） |
|---|---|---|
| cpu sidecar | 12,364,288 B | `A171F842…` |
| gpu sidecar | 67,955,200 B | `DA8E55B5…`（引用 `vulkan-1.dll`） |

把 CI 产物下载到本机直接运行（不安装任何 SDK）：

```
GET /health   → {"status":"ok","mode":"gpu"}
GET /v1/devices → {"devices":[{"id":"gpu:0","name":"NVIDIA GeForce GTX 1050 Ti (Vulkan)"}]}
```

两点结论：

- "显卡版是 CPU 拷贝"的问题可以在 CI 里彻底解决，本机不需要 Vulkan SDK。
- 现有 whisper 的设备枚举只返回**独显**（`device_type == GPU`），核显本来就不会出现在 GPU 选项里，与"GPU 只算独显"的规则一致。
- 注意：本地 `prepare-sidecars.mjs` 在没有 SDK 时仍会用 CPU 版本覆盖该产物；要用显卡版，需要走高版本地构建（装 SDK）或直接用 CI 打出的安装包。
