---
title: DB test seam - build test databases from the real migration chain
status: open
type: test-infrastructure
created: 2026-09-25
updated: 2026-09-25
commits:
  - 9ae92023 # the DB test this item is about
related:
  - apps/desktop/src-tauri/src/db/api_key_queries.rs
  - apps/desktop/src-tauri/src/db/mod.rs
  - apps/desktop/src-tauri/src/app.rs
---

# DB test seam

## Background

- `src-tauri/src/db/` holds 12 modules and 42 query functions.
- Production builds its pool in `app.rs` (Tauri setup) and lets `tauri-plugin-sql` apply
  `db::migrations()` - 69 SQL files, tracked by version - at startup.
- There is no way to build a test database that has the production schema. A test author
  either writes the helper or copies the SQL.
- `api_key_queries.rs` (added with the post-processing request options feature) was the first
  Rust test in this layer, and it copied the SQL: 7 `include_str!` files hand-picked to build
  `api_keys`.

## Problem

`api_keys` had two definitions: the `db::migrations()` registry and the test's array. They
agreed on the day they were written, but nothing keeps them in sync.

Consequences, in the order they bite:

1. A future migration that touches `api_keys` silently leaves the fixture behind. The test then
   asserts against a schema production no longer has - it can stay green while the real
   application refuses or ignores the same write. The test's subject (the three-state
   persistence of `post_processing_options`) is exactly what gets misreported.
2. A future migration that adds a column the query layer writes makes the test fail with
   `no such column`, for a reason unrelated to the change under test. The list has to be
   maintained by hand every time; 7 of the 69 migrations already touch this table.

Secondary: the test built its own tokio runtime
(`tokio::runtime::Builder::new_current_thread()`) while `Cargo.toml` declares tokio with only
`time, net, io-util, sync`. `Builder` needs `rt`, which the crate never asks for - it exists
only because `sqlx-core` and `tauri` enable it (`cargo tree -e features -i tokio`). A dependency
change can break the test's compilation with no visible cause in the test file.

## Evidence

Measured on 2026-09-25 by building two in-memory SQLite databases from the real files: one from
the registry, one from the test's list.

- Today the `api_keys` DDL is byte-identical between the two, and neither has triggers.
- Adding a hypothetical `070` migration that enforces "options must be a JSON object" and adds
  an audit column produced:

  | statement                                                | test fixture               | production |
  | -------------------------------------------------------- | -------------------------- | ---------- |
  | current INSERT, options = `{"thinking":{"level":"low"}}` | OK                         | OK         |
  | current INSERT, options = `[]`                           | OK                         | REFUSED    |
  | INSERT that also writes the new column                   | REFUSED (`no such column`) | OK         |

  Row 2 is the fidelity loss: the test reports a successful write that production rejects.
  Row 3 is the coupling: the test now fails for an unrelated reason until its list is edited.

## Current handling

Commit `9ae92023` removed the duplicate fixture for the one existing DB test:

- the test iterates `crate::db::migrations()` (Up entries) instead of listing files;
- blocking uses `tauri::async_runtime::block_on`, the pattern `app.rs` already uses, so the
  test no longer depends on an undeclared tokio feature.

`cargo test --lib db::api_key_queries` passes against the full 69-migration chain.

This fixes the existing test; it does not add a shared helper or cover the migration chain
itself.

## Deferred work

1. Migration chain smoke test: apply `migrations()` to an empty in-memory database and assert it
   succeeds. Today a broken migration is only discovered when the app fails at startup against a
   real database. ~10 lines, reuses the same loop as the current test.
2. Shared helper for building a test database. Do this when a second DB test appears - the owner
   is `db/mod.rs`, which already owns `migrations()`. Until then the single test's inline loop
   has no duplication to remove.
3. Decide how test targets get an async runtime: keep `tauri::async_runtime::block_on`, or declare
   an explicit `[dev-dependencies] tokio` with `rt` and `macros` and use `#[tokio::test]`.

## Handover notes

- Done when: a DB test can obtain the production schema by construction, and no test lists
  migration files by hand.
- Start at `db/mod.rs::migrations()` and `db/api_key_queries.rs::tests`.
- The same seam will be needed by the other query modules that still have no Rust tests
  (transcriptions, terms, tones, conversations, preferences, ...).
