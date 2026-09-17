# Voquill — Personal Windows Fork

This repository is a **personal fork of [voquill/voquill](https://github.com/voquill/voquill)**, maintained for private, personal use on **Windows Desktop only**.

- **Upstream project**: the original cross-platform voice typing product lives at [voquill/voquill](https://github.com/voquill/voquill) — see its [README](https://github.com/voquill/voquill#readme) for the full feature description, screenshots, and official downloads.
- **This fork**: trimmed to a Windows-only desktop app for long-term personal use. Product lines other than the desktop app (enterprise, mobile, CLI, docs site), macOS/Linux platform support, and the commercial/subscription layer have been removed. All free desktop functionality is preserved.
- **Support**: none. This fork is for my own use; do not expect issues to be handled. Use the upstream project for the official product.

## Build

```bash
pnpm install
pnpm run dev        # Windows desktop dev (Node >= 18, pnpm, Rust toolchain required)
```

Local Whisper runs fully offline; GPU-accelerated transcription requires the Vulkan SDK at build time.

## Branches

- `main` — the personal fork, actively developed here.
- `upstream-main` — read-only tracking branch of the upstream `main`; used to cherry-pick upstream fixes when relevant. No regular merging.

## License

This fork inherits the upstream license: **AGPLv3** — see [`LICENCE`](LICENCE). All remaining code is AGPLv3; the separately-licensed `enterprise/` tree of the upstream repository has been removed entirely and is not part of this fork. Attribution to the upstream project is preserved. This fork is not affiliated with, endorsed by, or representing Voquill, Inc.

## Development notes

Internal development documentation (divergence record, task planning) lives under [`.dev/`](.dev) — start with [`.dev/docs/upstream-divergence.md`](.dev/docs/upstream-divergence.md).
