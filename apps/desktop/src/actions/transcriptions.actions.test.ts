import type { Transcription } from "@voquill/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadAudio: vi.fn(),
  transcribe: vi.fn(),
  postProcess: vi.fn(),
  checkpointRaw: vi.fn(),
  checkpointFailure: vi.fn(),
  complete: vi.fn(),
  state: {
    transcriptionById: {} as Record<string, Transcription>,
    termById: {},
  },
}));

vi.mock("../repos", () => ({
  getTranscriptionRepo: () => ({ loadTranscriptionAudio: mocks.loadAudio }),
}));
vi.mock("../store", () => ({
  getAppState: () => mocks.state,
  produceAppState: vi.fn(),
}));
vi.mock("./transcribe.actions", () => ({
  transcribeAudio: mocks.transcribe,
  postProcessTranscript: mocks.postProcess,
}));
vi.mock("./transcription-lifecycle.actions", () => ({
  checkpointRawTranscription: mocks.checkpointRaw,
  checkpointTranscriptionFailure: mocks.checkpointFailure,
  completeRetranscription: mocks.complete,
  getTranscriptionFailureWarning: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import { retranscribeTranscription } from "./transcriptions.actions";

const transcription: Transcription = {
  id: "recording-id",
  transcript: "old text",
  rawTranscript: "old raw text",
  createdAt: "2026-09-17T00:00:00.000Z",
  createdByUserId: "user-id",
  isDeleted: false,
  audio: { filePath: "recording.wav", durationMs: 100 },
};

describe("retranscribeTranscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.transcriptionById = { [transcription.id]: transcription };
    mocks.state.termById = {};
    mocks.loadAudio.mockResolvedValue({ samples: [0.1], sampleRate: 16_000 });
    mocks.transcribe.mockResolvedValue({
      rawTranscript: "new raw text",
      warnings: [],
      metadata: { transcriptionMode: "api" },
    });
    mocks.checkpointRaw.mockImplementation(async (_current, checkpoint) => ({
      ...transcription,
      transcript: checkpoint.rawTranscript,
      rawTranscript: checkpoint.rawTranscript,
    }));
    mocks.checkpointFailure.mockImplementation(async (current) => current);
  });

  it("persists the new raw transcript before post-processing and keeps it when post-processing fails", async () => {
    const order: string[] = [];
    mocks.checkpointRaw.mockImplementation(async (_current, checkpoint) => {
      order.push("raw-checkpoint");
      return {
        ...transcription,
        transcript: checkpoint.rawTranscript,
        rawTranscript: checkpoint.rawTranscript,
      };
    });
    mocks.postProcess.mockImplementation(async () => {
      order.push("post-process");
      throw new Error("LLM unavailable");
    });

    await expect(
      retranscribeTranscription({ transcriptionId: transcription.id }),
    ).rejects.toThrow("LLM unavailable");

    expect(order).toEqual(["raw-checkpoint", "post-process"]);
    expect(mocks.checkpointFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "recording-id",
        transcript: "new raw text",
        rawTranscript: "new raw text",
      }),
      ["LLM unavailable"],
    );
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
