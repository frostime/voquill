---
title: 版本、打包与发布
description: 本 fork 的版本单一来源、本地打包步骤、安装/升级方式，以及发布到 GitHub Release 的流程。
scope:
  - /**
updated: 2026-09-18
---

# 版本、打包与发布

本文件描述这个个人 fork 自己的方案，与上游的多渠道发布体系无关。差异记录见
`upstream-divergence.md`。

## 版本号

单一事实来源：**`apps/desktop/src-tauri/Cargo.toml` 的 `version`**。

`tauri.conf.json` 里不再有 `version`，Tauri 会回落到 `CARGO_PKG_VERSION`，因此以下三处天然一致：

| 消费者 | 来源 |
|---|---|
| 安装包文件名 `Voquill_<version>_x64-setup.exe` | Cargo.toml |
| 前端 `getVersion()`（Dashboard、诊断对话框） | Cargo.toml（`tauri-codegen` 的 `context.rs` 回落到 `CARGO_PKG_VERSION`） |
| Rust 启动日志、诊断文件、exe 的版本资源 | Cargo.toml |

发布时只做一件事：改 `Cargo.toml` 里那一行（当前 `10.0.0`）。`Cargo.lock` 会在下次构建时自动跟上。

不要把 `version` 写回 `tauri.conf.json`——那会重新制造第二个来源，并与 Rust 侧的值分叉。
`apps/desktop/package.json` 的 `version` 字段已删除，不要加回来：它不参与打包。

## 本地打包

前置：Node 24（见 `.nvmrc`）、pnpm（`packageManager` 固定版本）、Rust（rustup）、
Tauri 的 Windows 前置（WebView2、VS Build Tools）。

```bash
pnpm install --frozen-lockfile
pnpm --filter desktop run tauri build --ci
```

它会依次：构建 Whisper sidecar（`scripts/run-tauri-with-sidecars.mjs` → `prepare-sidecars.mjs`，release profile）、
`vite build`（mode=prod）、`cargo --release` 与 bundle。

产物：

```text
apps/desktop/src-tauri/target/release/bundle/
  nsis/Voquill_<version>_x64-setup.exe    ← 推荐
  msi/Voquill_<version>_x64_en-US.msi
```

**不需要任何签名密钥。** updater 已于 2026-09-18 移除；在此之前，`createUpdaterArtifacts`
搭配占位公钥会让 bundle 阶段以 `A public key has been found, but no private key` 失败。

## 安装与升级

- 用 NSIS 的 `-setup.exe` 覆盖安装即可；identifier 不变（`com.voquill.desktop`），属同一应用的升级，不会变成并行安装。
- 用户数据在 `%APPDATA%\com.voquill.desktop\`（SQLite 与录音文件），不在安装目录，所以覆盖安装不会丢 History、设置或音频。
- 安装前从托盘退出运行中的 Voquill 与 pill 进程，避免文件占用。
- **没有应用内自动更新**：发布新版本后，由使用者下载新的安装包手动覆盖。

开发构建使用独立 flavor（`tauri.local.conf.json`，identifier `com.voquill.desktop.local`），
数据目录也独立（首次启动是空库 → welcome 引导）。不要把它和正式版的数据目录混用。

## 发布到 GitHub Release

目前是手动流程，没有 release workflow：

1. 递增 `apps/desktop/src-tauri/Cargo.toml` 的 `version` 并提交；
2. 按上面的步骤本地打包；
3. 创建 release 并上传两个安装包：

```bash
# 本仓库同时有 origin 与 upstream 两个 remote，gh 可能解析到上游仓库，
# 所以显式指定 --repo（或先跑一次 gh repo set-default frostime/voquill）
gh release create v10.0.0 --repo frostime/voquill \
  apps/desktop/src-tauri/target/release/bundle/nsis/Voquill_10.0.0_x64-setup.exe \
  apps/desktop/src-tauri/target/release/bundle/msi/Voquill_10.0.0_x64_en-US.msi \
  --title "10.0.0" --notes "<这一版相对上游/上一版的差异>"
```

误发时删除：`gh release delete v10.0.0 --repo frostime/voquill --cleanup-tag`。

不需要签名，也不需要 `latest.json`（没有 updater）。

CI（`.github/workflows/build-desktop.yml`）只在 PR 上构建并上传 artifact（保留 7 天），
不发布 release；它引用的 `CARGO_TARGET_DIR=D:\cargo` 是上游既有的做法：Windows runner 把
cargo target 与 bundle 输出放到 D: 暂存盘。

## 日常开发

```bash
pnpm --filter desktop run dev         # Tauri dev（identifier com.voquill.desktop.local）
pnpm --filter desktop run test:unit   # vitest
pnpm --filter desktop run build       # tsc + vite
cd apps/desktop/src-tauri && cargo check
```

## 已知残留与缺陷

见 `known-residue.md`。
