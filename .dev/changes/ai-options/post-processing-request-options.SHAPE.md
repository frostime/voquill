---
status: draft
---

# Post-processing provider request options

## Change

Add an optional JSON object to each API key's **post-processing** configuration. The object is passed to the selected provider's post-processing request so a private Windows Desktop user can configure provider-native parameters such as reasoning effort, thinking level, temperature, or token limits.

The feature is deliberately limited to this flow:

```text
ApiKey.postProcessingOptions
        ↓
post-processing composition root
        ↓
GenerateTextRepo.generateText()
        ↓
provider adapter
        ↓
provider-native request
```

It does not change transcription, cloud generation, or the upstream Agent/Assistant feature. Agent is not part of this fork's product requirement; its existing code remains untouched and is not a consumer of this option.

## Why this organization fits

The main design pressure is provider variation. OpenAI-style providers accept top-level request fields, Gemini places generation controls under `config`, and Claude uses a different top-level request shape. A single `low | medium | high` setting would make Voquill own provider/model capability mappings that change independently of the application.

The change therefore separates three responsibilities:

- `ApiKey` owns the persisted post-processing configuration.
- The desktop post-processing composition root decides when the configuration is in scope.
- Each provider adapter decides where the opaque object belongs and which fields remain application-owned.

The generic generation contracts stay unchanged. In particular, provider-native options do not enter `GenerativePrefs` or `GenerateTextInput`.

## Predicted diff

```text
packages/types/src/
└── apiKey.types.ts
    modify  +1–3/-0
    impact  additive public type change
    role    add nullable `postProcessingOptions: Record<string, unknown>`

apps/desktop/src-tauri/src/
├── domain/api_key.rs
│   modify  +8–18/-0–4
│   impact  carry opaque nullable JSON through the Tauri boundary
│   role    extend ApiKey, ApiKeyUpdateRequest, and ApiKeyView
├── db/api_key_queries.rs
│   modify  +12–30/-4–15
│   impact  preserve existing CRUD while adding the new column
│   role    insert, select, and update `post_processing_options`
├── commands.rs
│   modify  +1–5/-0–2
│   impact  initialize the new field for newly created keys
│   role    keep command/domain construction complete
├── db/migrations/069_api_key_post_processing_options.sql
│   create  +1–2
│   impact  additive nullable schema migration; use the next free version if 069 is no longer available
│   role    add `post_processing_options TEXT`
└── db/mod.rs
    modify  +5–10/-0–2
    impact  register the migration
    role    expose and register the new schema change

apps/desktop/src/
├── repos/api-key.repo.ts
│   modify  +18–35/-2–8
│   impact  preserve the existing object ↔ JSON TEXT persistence pattern
│   role    parse stored options and serialize update payloads
├── repos/index.ts
│   modify  +20–45/-5–20
│   impact  keep the shared factory but add a post-processing-only injection point
│   role    read the selected API key's options only in `getGenerateTextRepo()`
├── repos/generate-text.repo.ts
│   modify  +45–100/-10–35
│   impact  mechanical constructor/call plumbing across API-backed repos
│   role    retain options for `generateText()` and never pass them to `streamChat()`
├── components/settings/AIPostProcessingConfiguration.tsx
│   modify  +10–25/-0–5
│   impact  add the editor only to the post-processing settings path
│   role    render the options editor for the selected post-processing API key
└── components/settings/PostProcessingRequestOptionsField.tsx
    create  +70–130
    impact  isolated form state and JSON-object validation
    role    edit, validate, normalize, and save the raw JSON object

packages/voice-ai/src/
├── openai.utils.ts
│   modify  +12–30/-4–15
│   impact  preserve current request construction and add top-level options
│   role    support OpenAI, Ollama, and OpenAI-compatible paths
├── openrouter.utils.ts
│   modify  +12–30/-4–15
│   impact  preserve provider routing while defining explicit precedence
│   role    merge options into the OpenRouter request body
├── gemini.utils.ts
│   modify  +8–22/-3–12
│   impact  preserve content construction and JSON response behavior
│   role    merge options into `generateContent.config`
├── claude.utils.ts
│   modify  +8–22/-3–12
│   impact  preserve prompt construction and response extraction
│   role    merge options into the Messages request body
├── groq.utils.ts
│   modify  +8–22/-3–12
│   impact  preserve Groq-specific response-format behavior
│   role    accept OpenAI-style options for Groq post-processing
├── deepseek.utils.ts
│   modify  +8–22/-3–12
│   impact  preserve DeepSeek defaults and JSON handling
│   role    accept OpenAI-style options for DeepSeek post-processing
├── cerebras.utils.ts
│   modify  +8–22/-3–12
│   impact  preserve the model-specific reasoning default
│   role    allow configured options to override optional defaults
└── azure-openai.utils.ts
    modify  +8–22/-3–12
    impact  preserve Azure endpoint/deployment ownership
    role    accept OpenAI-style options without allowing deployment replacement

tests/
├── desktop API-key persistence and settings tests
│   create/modify  grouped +50–110
│   role           round-trip, validation, clearing, and selected-key behavior
├── desktop repo/factory tests
│   create/modify  grouped +35–80
│   role           prove post-processing injection and Agent/transcription isolation
└── voice-ai request-construction tests
    create/modify  grouped +80–160
    role           prove provider placement, merge precedence, and protected fields

CHANGELOG.md
└── modify  +1–5/-0
    impact  record the user-visible setting under `[Unreleased]`
```

The exact test filenames may follow the repository's existing test layout. They are grouped here because their ownership is already determined by the contracts above.

## Ownership and dependency shifts

### Persisted state

Before:

```text
ApiKey
  ├─ postProcessingModel
  └─ provider-specific configuration
```

After:

```text
ApiKey
  ├─ postProcessingModel
  ├─ postProcessingOptions  ← opaque provider-native post-processing settings
  └─ provider-specific configuration
```

The value is stored as nullable JSON text in SQLite. Persistence validates only that the value is a JSON object when it comes from the settings form; it does not validate provider-specific keys.

### Scope

```text
getGenerateTextRepo()
  ├─ select the post-processing API key
  ├─ read postProcessingOptions
  └─ inject options into API-backed GenerateTextRepo instances

getAgentRepo()
  └─ unchanged; does not read or receive postProcessingOptions
```

The Agent/Assistant feature is an upstream residual outside this change. No Agent UI, Agent state, chat path, or tool path is modified. The same API key may be selected by both features; that does not make the post-processing option global.

The transcription factory also remains unchanged and never receives this field.

### Provider knowledge

```text
settings / ApiKey repo / Rust / SQLite
    opaque object only
            │
            ▼
desktop GenerateTextRepo
    post-processing transport only
            │
            ▼
voice-ai provider adapter
    native placement + merge rules
```

## Request-options contract

The persisted value is an object, not a complete request replacement:

```ts
postProcessingOptions?: Record<string, unknown> | null;
```

The voice-ai adapter argument may use the shorter name:

```ts
requestOptions?: Record<string, unknown>;
```

### Merge rules

Use shallow merge only. The general order is:

```text
provider/application defaults
        ↓
existing structured provider configuration
        ↓
user requestOptions
        ↓
application-owned structural fields
```

The user may override optional/tunable fields such as temperature, top-p, token limits, and provider reasoning controls.

The application always owns the fields required to perform the operation:

- selected model/deployment;
- prompt messages or contents;
- streaming mode for the operation;
- structured response schema/format when `jsonResponse` is active.

When `jsonResponse` is not active, an explicitly supplied provider response-format option may pass through. When it is active, the application-generated schema wins.

OpenRouter's existing structured `providerRouting` configuration is applied before raw options. If both specify the same optional request field, raw `postProcessingOptions` wins. No deep merge is performed; a nested user object replaces the corresponding nested object.

Provider placement is adapter-owned:

```text
OpenAI / OpenAI-compatible / Ollama / Groq / DeepSeek / Cerebras / Azure OpenAI:
  options → OpenAI-style request top level

OpenRouter:
  options → OpenRouter request body

Gemini:
  options → generateContent.config

Claude:
  options → messages.create request body
```

Unsupported or misspelled provider options are left to the provider SDK/API to reject. Voquill does not maintain a provider capability matrix or field whitelist.

## Persistence update semantics

The update contract must distinguish these states:

```text
field omitted       → leave the existing database value unchanged
field = object      → store the serialized JSON object
field = null/empty  → clear the database value
```

A plain Rust `Option<String>` cannot distinguish “omitted” from “explicitly clear” in an update request. The implementation must use an explicit tri-state representation or an equivalent update mechanism for this field. This is required so the settings editor can remove an existing configuration reliably.

## UI behavior

The editor is rendered only from the post-processing settings path, not inside the shared API-key list used by the upstream Agent settings.

Accepted:

```json
{
  "reasoning_effort": "low"
}
```

```json
{
  "thinkingConfig": {
    "thinkingLevel": "low"
  }
}
```

Rejected before save:

```json
null
```

```json
[]
```

```json
"low"
```

Rules:

- empty or whitespace-only input clears the setting;
- non-empty input must parse as a JSON object;
- arrays and primitive JSON values are invalid;
- no provider-specific validation is performed in the UI;
- persisted objects may be pretty-printed when reopened;
- formatting and comments are not preserved;
- an optional size limit may prevent accidental large pastes, but is not a security boundary.

## Preserved invariants

1. No options configured means provider requests behave as they do today.
2. Existing API-key rows migrate with a null value and require no data rewrite.
3. `GenerativePrefs` remains free of provider-native request state.
4. `GenerateTextInput` remains free of provider-native request state.
5. `generateText()` may receive post-processing options; `streamChat()` does not.
6. Transcription paths never receive post-processing options.
7. Cloud-managed generation never receives local raw request options.
8. Voquill continues to own model selection and prompt/message construction.
9. When structured JSON output is requested, the application-generated response schema remains authoritative.
10. The Agent/Assistant feature is not modified by this change.
11. Complete option JSON is not added to logs.

## Acceptance coverage

- An API-key options object, including nested values, round-trips through the TypeScript → Tauri/Rust → SQLite path.
- An old API-key row with no value loads as `null`.
- An existing value can be cleared from the settings editor and is absent on the next load.
- Empty input, `null`, arrays, primitives, and invalid JSON are rejected or normalized according to the UI rules above.
- OpenAI-style providers receive top-level options while application-owned model/messages remain authoritative.
- OpenRouter receives options in its request body and raw options have the documented precedence over structured provider routing.
- Gemini receives options under `config`.
- Claude receives options in its native request body.
- `jsonResponse` keeps ownership of the structured response schema.
- All API-backed post-processing providers selected by `getGenTextRepoInternal()` either adopt the contract or explicitly share an adapter path that does.
- `getGenerateTextRepo()` uses the selected API key's options; transcription and cloud paths do not.
- The Agent/Assistant code and UI are not part of the diff, and no new option flow reaches `getAgentRepo()` or `streamChat()`.
- No-options request behavior remains equivalent to the current implementation.

## Deliberately excluded

- no Agent/Assistant removal or UI redesign;
- no universal reasoning-level enum;
- no provider/model capability matrix;
- no provider-specific whitelist;
- no deep-merge engine;
- no automatic translation between provider option vocabularies;
- no transcription options;
- no cloud-generation options;
- no migration of existing `openRouterConfig` into the raw options field;
- no generic provider/plugin framework.

## Decision

Keep the opaque `ApiKey.postProcessingOptions` design, with post-processing-only composition-root injection and provider-owned native placement. Keep this SHAPE at `draft` until the user accepts the revised boundary and the implementation begins.
