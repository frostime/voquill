import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalApiKeyRepo } from "./api-key.repo";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const rawApiKey = (overrides: Record<string, unknown> = {}) => ({
  id: "key-1",
  name: "Test",
  provider: "openai",
  createdAt: 1,
  ...overrides,
});

const updateRequest = () =>
  mocks.invoke.mock.calls[0]?.[1]?.request as Record<string, unknown>;

describe("LocalApiKeyRepo post-processing options", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
  });

  it("serializes a saved options object and does not clear it", async () => {
    mocks.invoke.mockResolvedValue(rawApiKey());

    await new LocalApiKeyRepo().updateApiKey({
      id: "key-1",
      postProcessingOptions: { reasoning_effort: "low" },
    });

    expect(updateRequest()).toMatchObject({
      postProcessingOptions: '{"reasoning_effort":"low"}',
      clearPostProcessingOptions: false,
    });
  });

  it("leaves stored options untouched when the payload omits them", async () => {
    mocks.invoke.mockResolvedValue(rawApiKey());

    await new LocalApiKeyRepo().updateApiKey({ id: "key-1", name: "Renamed" });

    expect(updateRequest()).toMatchObject({
      postProcessingOptions: undefined,
      clearPostProcessingOptions: false,
    });
  });

  it("clears stored options when the payload sends null", async () => {
    mocks.invoke.mockResolvedValue(rawApiKey());

    await new LocalApiKeyRepo().updateApiKey({
      id: "key-1",
      postProcessingOptions: null,
    });

    expect(updateRequest()).toMatchObject({
      postProcessingOptions: undefined,
      clearPostProcessingOptions: true,
    });
  });

  it("parses stored options back into an object", async () => {
    mocks.invoke.mockResolvedValue([
      rawApiKey({
        postProcessingOptions: '{"thinkingConfig":{"thinkingLevel":"low"}}',
      }),
    ]);

    const [apiKey] = await new LocalApiKeyRepo().listApiKeys();

    expect(apiKey?.postProcessingOptions).toEqual({
      thinkingConfig: { thinkingLevel: "low" },
    });
  });

  it("treats unreadable stored options as absent", async () => {
    mocks.invoke.mockResolvedValue([
      rawApiKey({ postProcessingOptions: "[1,2,3]" }),
    ]);

    const [apiKey] = await new LocalApiKeyRepo().listApiKeys();

    expect(apiKey?.postProcessingOptions).toBeNull();
  });
});
