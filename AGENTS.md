** What this repository is **

- Personal fork of [voquill/voquill](https://github.com/voquill/voquill): Windows Desktop only, for private long-term use. Not an upstream PR — never preserve upstream compatibility at the cost of personal-use simplicity.
- Highest constraint: free (non-subscription) Windows Desktop features must keep their behavior. Removing infrastructure that a kept feature depends on requires migrating that feature to a local owner first — never delete the caller to make compilation pass.
- Divergence record, task orchestration, and regression contract live in `.dev/`; start at `.dev/docs/upstream-divergence.md`.

** Rules **

- Do not propose band-aid fixes to problems. Identify the root cause, be it architectural or logical, and address it directly.
- Enforce DRY code principles. Avoid over-engineering. Implement the simplest solution that meets requirements.
- Keep changes minimal; preserve unrelated contracts and behavior.
- Write clear, maintainable, self-documenting code. No comments except for non-obvious things.
- Prefer to follow existing patterns (dialogs, state management, API interactions).
- Use `<FormattedMessage defaultMessage="..." />` or `useIntl()` for i18n — never pass an `id` prop.
- Tolerated dead code exists by user decision. Do not "clean it up" unless asked; the authoritative list of what must stay is the 禁清理项 section of `.dev/docs/upstream-divergence.md`.
- App version has a single source of truth: `apps/desktop/src-tauri/Cargo.toml`. Do not add the version back to `tauri.conf.json`; see `.dev/docs/release.md`.

** Repository structure **

- Turborepo monorepo. Root-level: `pnpm run build`, `pnpm run lint`, `pnpm run check-types`, `pnpm run test`.
- Shared packages in `packages/` (`types`, `utilities`, `voice-ai`, `rust_transcription`, `rust_windows_pill`, `desktop-native-apis`, ...). After modifying `packages/types` or `packages/functions`, rebuild before downstream consumers see changes.

** `apps/desktop` — Tauri desktop app (Rust + TypeScript/React), the only product **

- "Rust is the API, TypeScript is the Brain" — all business logic in TypeScript; Rust provides pure API capabilities (audio, hotkeys, injection, SQLite) without decision-making.
- Single source of truth for state is Zustand (with Immer) in TypeScript.
- Data flow: User/Native Event → Actions (`src/actions/`) → Repos (`src/repos/`) → Tauri Commands (`src-tauri/src/commands.rs`) → SQLite/Whisper/APIs.
- Repos abstract local vs remote: `BaseXxxRepo` defines the interface, `LocalXxxRepo` / `CloudXxxRepo` implement. The fork keeps Cloud implementations as tolerated dead code; new work should target Local paths.
- Database migrations go in `src-tauri/src/db/migrations/` as `NNN_description.sql`, registered in `db/mod.rs`.
- New Tauri commands: define in `commands.rs`, register in `app.rs` invoke_handler, create a repo, use in actions.
- Platform code is Windows-only (`src-tauri/src/platform/windows/`); `platform/mod.rs` keeps the OS abstraction boundary — implement new OS capabilities behind it.

** `.dev/` — development workspace (tracked) **

- `docs/` durable cross-module docs; `changes/<slug>/` active change artifacts.
