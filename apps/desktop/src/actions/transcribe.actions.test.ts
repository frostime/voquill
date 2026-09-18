import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: {
    enterpriseConfig: null as { allowPostProcessing?: boolean } | null,
  },
  generateText: vi.fn(),
  getGenerateTextRepo: vi.fn(),
  getToneById: vi.fn(),
}));

vi.mock("../repos", () => ({
  getGenerateTextRepo: mocks.getGenerateTextRepo,
  getTranscribeAudioRepo: vi.fn(),
}));
vi.mock("../store", () => ({ getAppState: () => mocks.state }));
vi.mock("../utils/ai.utils", () => ({
  extractJsonFromMarkdown: (value: string) => value,
  unwrapNestedLlmResponse: (value: unknown) => value,
}));
vi.mock("../utils/language.utils", () => ({
  coerceToDictationLanguage: (value: string) => value,
  mapDictationLanguageToWhisperLanguage: vi.fn(),
}));
vi.mock("../utils/log.utils", () => ({
  getLogger: () => ({
    info: vi.fn(),
    verbose: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock("../utils/prompt.utils", () => ({
  buildLocalizedTranscriptionPrompt: vi.fn(),
  buildPostProcessingPrompt: () => "post-process prompt",
  buildSystemPostProcessingTonePrompt: () => "system prompt",
  collectDictionaryEntries: vi.fn(),
  PROCESSED_TRANSCRIPTION_JSON_SCHEMA: {},
  PROCESSED_TRANSCRIPTION_SCHEMA: {
    safeParse: () => ({ success: true, data: { result: "refined text" } }),
  },
}));
vi.mock("../utils/tone.utils", () => ({
  getToneById: mocks.getToneById,
  getToneConfig: () => ({}),
}));
vi.mock("../utils/user.utils", () => ({
  getMyUserName: () => "User",
  loadMyEffectiveDictationLanguage: async () => "en",
}));

import { postProcessTranscript } from "./transcribe.actions";

const configuredRepo = () => ({
  repo: { generateText: mocks.generateText },
  apiKeyId: "key-id",
  warnings: [],
});

const noRepo = () => ({
  repo: null,
  apiKeyId: null,
  warnings: [],
});

describe("postProcessTranscript generation lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.enterpriseConfig = null;
    mocks.getGenerateTextRepo.mockImplementation(configuredRepo);
    mocks.getToneById.mockReturnValue({ shouldDisablePostProcessing: false });
    mocks.generateText.mockResolvedValue({
      text: "{}",
      metadata: {
        postProcessingMode: "api",
        inferenceDevice: "test model",
      },
    });
  });

  it("announces generation immediately before calling the model", async () => {
    const order: string[] = [];
    const onGenerationStart = vi.fn(() => {
      order.push("generation-start");
    });
    mocks.generateText.mockImplementation(async () => {
      order.push("generate-text");
      return {
        text: "{}",
        metadata: { postProcessingMode: "api" },
      };
    });

    await postProcessTranscript({
      rawTranscript: "raw text",
      toneId: "default",
      onGenerationStart,
    });

    expect(order).toEqual(["generation-start", "generate-text"]);
    expect(onGenerationStart).toHaveBeenCalledTimes(1);
  });

  it("continues generation when the lifecycle observer fails", async () => {
    const onGenerationStart = vi
      .fn()
      .mockRejectedValue(new Error("IPC failed"));

    const result = await postProcessTranscript({
      rawTranscript: "raw text",
      toneId: "default",
      onGenerationStart,
    });

    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(result.transcript).toBe("refined text");
  });

  it("does not announce generation when the tone disables post-processing", async () => {
    mocks.getToneById.mockReturnValue({ shouldDisablePostProcessing: true });
    const onGenerationStart = vi.fn();

    await postProcessTranscript({
      rawTranscript: "raw text",
      toneId: "verbatim",
      onGenerationStart,
    });

    expect(onGenerationStart).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("does not announce generation when no generation repo is configured", async () => {
    mocks.getGenerateTextRepo.mockImplementation(noRepo);
    const onGenerationStart = vi.fn();

    await postProcessTranscript({
      rawTranscript: "raw text",
      toneId: "default",
      onGenerationStart,
    });

    expect(onGenerationStart).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
