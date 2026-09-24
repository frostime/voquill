# 配置润色模型请求参数

## 问题

当前 Voquill 可以选择润色模型，但不能配置模型请求中的额外参数。对于推理模型，用户无法把推理程度调低，导致润色请求可能进行不必要的长时间推理。

不同 provider 使用的参数名称和请求结构并不一致。例如，有的使用 `reasoning_effort`，有的使用嵌套的 `thinkingConfig`。因此，需求不是在 Voquill 中增加一个统一的 `low / medium / high` 枚举，而是允许用户填写 provider 原生 JSON 参数。

成功标准是：用户可以为润色 API Key 保存一组 JSON 对象；润色请求将这些参数放到对应 provider 的请求位置；没有配置参数时，现有行为不变。

## 方案

在 API Key 上增加可选的润色请求参数：

```ts
postProcessingOptions?: Record<string, unknown> | null;
```

设置界面使用 JSON 编辑器。桌面端内部保持对象形式；Tauri/Rust 和 SQLite 之间以 nullable JSON 文本传递和保存。

参数只通过 post-processing 的 `generateText()` 路径传递：

```text
API Key
  → post-processing repo factory
  → GenerateTextRepo.generateText()
  → provider adapter
  → provider-native request
```

provider adapter 负责把 JSON 放入正确的请求位置。参数只做浅层合并，不建立统一的 provider capability matrix，也不做 provider-specific whitelist。

上游自带的 Agent/Assistant 是另一项功能，不是语音转文字，也不是本次需求的一部分。本变更不修改或删除 Agent；不向 Agent 的 `streamChat()` 路径传递 `postProcessingOptions`。

## 行为约定

### JSON 编辑器

允许保存 JSON 对象，例如：

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

以下内容不能保存：

```json
null
```

```json
[]
```

```json
"low"
```

空白输入表示清除当前配置。JSON 语法错误、数组和基本类型应在保存前提示用户。

不在 UI 中判断具体 provider 是否支持某个字段。未被 provider 接受的字段由 provider SDK/API 报错。

### 请求参数作用域

- 润色 API Key 的 `postProcessingOptions` 只用于润色 `generateText()`。
- 转录请求不使用该字段。
- 云端生成不使用本地 API 参数。
- Agent/Assistant 不使用该字段；`streamChat()` 不接收该配置。
- `GenerativePrefs` 和 `GenerateTextInput` 不增加 provider-native options。

### 合并规则

用户参数可以覆盖 provider 请求中的可调参数，例如：

- `temperature`；
- `top_p`；
- token 上限；
- provider-specific reasoning 参数。

应用始终控制完成当前操作所需的结构字段，包括：

- 已选择的模型或 deployment；
- prompt、messages 或 contents；
- 当前操作的流式模式；
- `jsonResponse` 开启时的结构化响应 schema/format。

只做浅层合并。用户提供的嵌套对象整体替换同名嵌套对象，不进行递归合并。

provider 参数位置由 adapter 决定：

- OpenAI-style provider：请求顶层；
- OpenRouter：请求体顶层；
- Gemini：`generateContent.config`；
- Claude：Messages 请求体顶层。

### 持久化更新

更新接口必须区分：

- 字段未提供：保留已有值；
- 提供 JSON 对象：保存新值；
- 提供 `null` 或空输入：清除已有值。

实现不能让 Rust 的普通 `Option<String>` 把“未更新”和“明确清除”混为一谈。

## 实现决策

1. `ApiKey` 是 `postProcessingOptions` 的状态 owner，因为它已经拥有 `postProcessingModel` 及其他 provider 配置。
2. SQLite 新增 nullable `TEXT` 字段，旧记录迁移后默认为 `NULL`。
3. `getGenerateTextRepo()` 读取所选 API Key 的参数；`getAgentRepo()` 不读取该字段。
4. `GenerateTextRepo` 的 API-backed 实现通过构造或配置接收参数，但只在 `generateText()` 中转发。
5. provider adapter 负责 native placement、浅层合并和应用结构字段保护。
6. 第一版覆盖当前 post-processing factory 支持的 API provider；OpenAI-compatible/Ollama 复用 OpenAI-style 请求路径时沿用同一 contract。
7. 不引入统一 reasoning enum、provider whitelist、能力矩阵或通用 deep-merge 抽象。
8. 本次不处理 Agent/Assistant 的屏蔽或删除。若之后要移除该上游功能，另开独立 change。

## 验收标准

- 可以在 post-processing 设置中输入并保存 JSON 对象。
- 重新打开设置后，已保存对象仍能正确显示。
- 嵌套对象、数组值、数字、布尔值等 JSON 内容可以 round-trip。
- 空白输入可以清除已有配置。
- `null`、数组、字符串、数字和非法 JSON 不能保存为 options 对象。
- 旧 API Key 没有该字段时，应用正常运行并按无 options 处理。
- OpenAI-style provider 能收到顶层 options。
- OpenRouter 能收到请求体顶层 options，并且与既有 provider routing 的优先级符合约定。
- Gemini 能在 `config` 中收到 options。
- Claude 能在 native request body 中收到 options。
- `model`、prompt/messages/contents 和启用 `jsonResponse` 时的 schema 仍由应用控制。
- 没有配置 options 时，请求行为与改动前一致。
- 转录、云端生成和 Agent/Assistant 路径不会收到 `postProcessingOptions`。
- 相关 TypeScript、Rust、provider adapter 测试，以及项目已有的类型检查和 lint 可以通过。

## 术语

- **转录（transcription）**：把音频转换为原始文字。
- **润色（post-processing）**：把转录得到的原始文字交给语言模型，生成最终文字。
- **Agent/Assistant**：上游附带的助手聊天功能，可以进行对话和工具调用；它不属于本 change 的功能范围。
- **provider-native options**：某个模型供应商自己的请求参数和结构，例如 `reasoning_effort` 或 `thinkingConfig`。
