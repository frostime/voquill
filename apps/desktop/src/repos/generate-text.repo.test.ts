import type { ApiKey } from "@voquill/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AppState, INITIAL_APP_STATE } from "../state/app.state";
import { setAppState } from "../store";
import { getAgentRepo, getGenerateTextRepo } from ".";

const mocks = vi.hoisted(() => ({
  openaiGenerateTextResponse: vi.fn(),
}));

vi.mock("@voquill/voice-ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@voquill/voice-ai")>()),
  openaiGenerateTextResponse: mocks.openaiGenerateTextResponse,
}));

vi.mock("../utils/log.utils", () => ({
  getLogger: () => ({
    info: vi.fn(),
    verbose: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

const postProcessingOptions = { reasoning_effort: "low" };

const apiKey: ApiKey = {
  id: "key-1",
  name: "Test key",
  provider: "openai",
  createdAt: "2026-09-25T00:00:00.000Z",
  keyFull: "sk-test",
  postProcessingOptions,
};

const makeState = (): AppState => ({
  ...structuredClone(INITIAL_APP_STATE),
  apiKeyById: { [apiKey.id]: apiKey },
  settings: {
    ...structuredClone(INITIAL_APP_STATE.settings),
    aiPostProcessing: { mode: "api", selectedApiKeyId: apiKey.id },
    agentMode: {
      mode: "api",
      selectedApiKeyId: apiKey.id,
      openclawGatewayUrl: null,
      openclawToken: null,
    },
  },
});

beforeEach(() => {
  setAppState(makeState(), true);
  mocks.openaiGenerateTextResponse.mockReset();
  mocks.openaiGenerateTextResponse.mockResolvedValue({
    text: "rewritten",
    tokensUsed: 3,
  });
});

describe("request options are scoped to post-processing", () => {
  it("passes the selected post-processing key's options to the provider request", async () => {
    const { repo } = getGenerateTextRepo();
    if (!repo) throw new Error("expected an API-backed generate text repo");

    await repo.generateText({ prompt: "Rewrite this" });

    expect(mocks.openaiGenerateTextResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-test",
        requestOptions: postProcessingOptions,
      }),
    );
  });

  it("keeps post-processing options out of the agent session", async () => {
    const { repo } = getAgentRepo();
    if (!repo) throw new Error("expected an API-backed generate text repo");

    await repo.generateText({ prompt: "Rewrite this" });

    expect(mocks.openaiGenerateTextResponse).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-test", requestOptions: undefined }),
    );
  });
});
