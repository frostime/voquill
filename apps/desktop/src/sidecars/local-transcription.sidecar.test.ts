import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  resolveResource: vi.fn(),
  state: {
    settings: {
      aiTranscription: {
        modelsDir: "D:/Models",
        modelsDirChangeStatus: null as "saving" | "restart-required" | null,
        modelDownloadSource: "mirror",
      },
    },
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  resolveResource: mocks.resolveResource,
  appDataDir: async () => "C:/AppData/Voquill",
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("../store", () => ({ getAppState: () => mocks.state }));
vi.mock("../i18n", () => ({
  getIntl: () => ({
    formatMessage: ({ defaultMessage }: { defaultMessage: string }) =>
      defaultMessage,
  }),
}));
vi.mock("../utils/log.utils", () => ({
  getLogger: () => ({ info: vi.fn(), warning: vi.fn(), verbose: vi.fn() }),
}));
vi.mock("./sidecar.utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sidecar.utils")>()),
  fetchWithTimeout: mocks.fetch,
}));

import { LocalTranscriptionSidecar } from "./local-transcription.sidecar";

class TestSidecar extends LocalTranscriptionSidecar {
  override async ensureStarted() {
    return {
      port: 1234,
      baseUrl: "http://127.0.0.1:1234",
      child: { pid: 1, kill: async () => {}, write: async () => {} },
    };
  }

  spawnEnv() {
    return this.buildSpawnEnv();
  }
}

const modelStatus = {
  model: "tiny",
  downloaded: true,
  valid: true,
  fileBytes: 77_691_713,
  validationError: null,
};
const input = {
  model: "tiny" as const,
  samples: [0.1, 0.2],
  sampleRate: 16_000,
  preferGpu: true,
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const downloadRequests = () =>
  mocks.fetch.mock.calls.filter(([url]) => String(url).includes("/download"));

const serveTranscription = () => {
  mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/download")) {
      return reply({ jobId: "job", model: "tiny", status: "completed" });
    }
    if (url.includes("/status?")) return reply(modelStatus);
    if (url.endsWith("/sessions")) return reply({ sessionId: "session" });
    if (url.endsWith("/finalize")) {
      return reply({
        text: "transcribed",
        model: "tiny",
        inferenceDevice: "GPU",
        durationMs: 1,
      });
    }
    if (init?.method === "DELETE") return reply({ deleted: true });
    return reply({ receivedSamples: 2, bufferedSamples: 2 });
  });
};

describe("local model runtime contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.settings.aiTranscription.modelsDirChangeStatus = null;
    mocks.resolveResource.mockImplementation(
      async (path: string) => `C:/Voquill/${path}`,
    );
    serveTranscription();
  });

  it("resolves the DLL directory at the path used inside the Windows bundle", async () => {
    const env = await new TestSidecar("cpu").spawnEnv();
    expect(env.RUST_TRANSCRIPTION_NATIVE_DIR).toBe(
      "C:/Voquill/resources/transcribe",
    );
    expect(env.RUST_TRANSCRIPTION_MODELS_DIR).toBe("D:/Models");
  });

  it("rejects a missing model before starting a recording session, without downloading", async () => {
    mocks.fetch.mockImplementation(async (url: string) =>
      url.includes("/download")
        ? reply({ jobId: "job", status: "completed" })
        : reply({ ...modelStatus, downloaded: false, valid: false }),
    );
    await expect(
      new TestSidecar("gpu").createStreamingSession(input),
    ).rejects.toThrow(/Settings/);
    expect(downloadRequests()).toHaveLength(0);
    expect(
      mocks.fetch.mock.calls.some(([url]) => String(url).endsWith("/sessions")),
    ).toBe(false);
  });

  it("reports model loading failures instead of trying to repair them by downloading", async () => {
    mocks.fetch.mockImplementation(async (url: string) =>
      url.includes("/download")
        ? reply({ jobId: "job", status: "completed" })
        : reply({
            ...modelStatus,
            valid: false,
            validationError: "runtime unavailable",
          }),
    );
    await expect(new TestSidecar("gpu").transcribe(input)).rejects.toThrow(
      "runtime unavailable",
    );
    expect(downloadRequests()).toHaveLength(0);
  });

  it("does not download and retry when a previously ready model disappears", async () => {
    const sidecar = new TestSidecar("gpu");
    await expect(sidecar.transcribe(input)).resolves.toMatchObject({
      text: "transcribed",
    });
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes("/download"))
        return reply({ jobId: "job", status: "completed" });
      return reply(
        { error: { code: "model_not_downloaded", message: "model missing" } },
        404,
      );
    });
    await expect(sidecar.transcribe(input)).rejects.toMatchObject({
      code: "model_not_downloaded",
      message: expect.stringMatching(/Settings/),
    });
    expect(downloadRequests()).toHaveLength(0);
  });

  it("keeps explicit model downloads available", async () => {
    await expect(
      new TestSidecar("cpu").downloadModel("tiny"),
    ).resolves.toMatchObject({ downloaded: true, valid: true });
    expect(downloadRequests()).toHaveLength(1);
  });

  it.each(["saving", "restart-required"] as const)(
    "refuses runtime work while model folder status is %s",
    async (status) => {
      mocks.state.settings.aiTranscription.modelsDirChangeStatus = status;
      await expect(
        new TestSidecar("cpu").getModelStatus("tiny"),
      ).rejects.toThrow(/Restart/);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );
});
