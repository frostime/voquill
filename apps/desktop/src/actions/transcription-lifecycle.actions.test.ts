import type { Transcription } from "@voquill/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  createTranscription: vi.fn(),
  updateTranscription: vi.fn(),
  purgeStaleAudio: vi.fn(),
  addWords: vi.fn(),
  showError: vi.fn(),
  createId: vi.fn(() => "stable-id"),
  state: {
    userPrefs: {
      incognitoModeEnabled: false,
      incognitoModeIncludeInStats: false,
    },
    transcriptionById: {} as Record<string, Transcription>,
    transcriptions: { transcriptionIds: [] as string[] },
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../repos", () => ({
  getTranscriptionRepo: () => ({
    createTranscription: mocks.createTranscription,
    updateTranscription: mocks.updateTranscription,
    purgeStaleAudio: mocks.purgeStaleAudio,
  }),
}));
vi.mock("../store", () => ({
  getAppState: () => mocks.state,
  produceAppState: (recipe: (state: typeof mocks.state) => void) =>
    recipe(mocks.state),
}));
vi.mock("../utils/id.utils", () => ({ createId: mocks.createId }));
vi.mock("../utils/user.utils", () => ({
  getMyEffectiveUserId: () => "user-id",
}));
vi.mock("../utils/log.utils", () => ({
  getLogger: () => ({
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock("./app.actions", () => ({ showErrorSnackbar: mocks.showError }));
vi.mock("./user.actions", () => ({
  addWordsToCurrentUser: mocks.addWords,
}));

import {
  beginRecordingLifecycle,
  checkpointRawTranscription,
  checkpointTranscriptionFailure,
  completeTranscriptionLifecycle,
} from "./transcription-lifecycle.actions";

const audio = { samples: [0.1, 0.2], sampleRate: 16_000 };
const audioSnapshot = { filePath: "recordings/stable-id.wav", durationMs: 10 };

const makeTranscription = (
  overrides: Partial<Transcription> = {},
): Transcription => ({
  id: "stable-id",
  transcript: "",
  rawTranscript: "",
  createdAt: "2026-09-17T00:00:00.000Z",
  createdByUserId: "user-id",
  isDeleted: false,
  audio: audioSnapshot,
  warnings: null,
  ...overrides,
});

describe("recording transcription lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.userPrefs.incognitoModeEnabled = false;
    mocks.state.userPrefs.incognitoModeIncludeInStats = false;
    mocks.state.transcriptionById = {};
    mocks.state.transcriptions.transcriptionIds = [];
    mocks.invoke.mockResolvedValue(audioSnapshot);
    mocks.createTranscription.mockImplementation(async (value) => value);
    mocks.updateTranscription.mockImplementation(async (value) => value);
    mocks.purgeStaleAudio.mockResolvedValue([]);
  });

  it("durably creates audio and one history row before applying retention", async () => {
    const calls: string[] = [];
    mocks.invoke.mockImplementation(async () => {
      calls.push("audio");
      return audioSnapshot;
    });
    mocks.createTranscription.mockImplementation(async (value) => {
      calls.push("row");
      return value;
    });
    mocks.purgeStaleAudio.mockImplementation(async () => {
      calls.push("retention");
      return [];
    });

    const lifecycle = await beginRecordingLifecycle(audio);

    expect(calls).toEqual(["audio", "row", "retention"]);
    expect(mocks.invoke).toHaveBeenCalledWith("store_transcription_audio", {
      id: "stable-id",
      samples: audio.samples,
      sampleRate: audio.sampleRate,
    });
    expect(mocks.createTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "stable-id",
        transcript: "",
        audio: audioSnapshot,
      }),
    );
    expect(lifecycle.transcription?.id).toBe("stable-id");
    expect(mocks.state.transcriptions.transcriptionIds).toEqual(["stable-id"]);
  });

  it("stops before creating a row when audio persistence fails", async () => {
    mocks.invoke.mockRejectedValue(new Error("disk full"));

    await expect(beginRecordingLifecycle(audio)).rejects.toThrow("disk full");

    expect(mocks.createTranscription).not.toHaveBeenCalled();
    expect(mocks.purgeStaleAudio).not.toHaveBeenCalled();
    expect(mocks.showError).toHaveBeenCalledWith(
      "Unable to save recording audio. Processing stopped.",
    );
  });

  it("treats history creation failure as fatal and does not run retention", async () => {
    mocks.createTranscription.mockRejectedValue(new Error("database locked"));

    await expect(beginRecordingLifecycle(audio)).rejects.toThrow(
      "database locked",
    );

    expect(mocks.purgeStaleAudio).not.toHaveBeenCalled();
    expect(mocks.showError).toHaveBeenCalledWith(
      "Unable to save recording history. Processing stopped.",
    );
  });

  it("checkpoints raw text and keeps it as the final fallback", async () => {
    const initial = makeTranscription();

    const transcribed = await checkpointRawTranscription(initial, {
      rawTranscript: "recoverable raw text",
      metadata: { transcriptionMode: "api", modelSize: "whisper-large" },
      warnings: ["provider warning"],
    });
    const completed = await completeTranscriptionLifecycle(
      { transcription: transcribed, trackWordStats: true },
      {
        transcript: null,
        sanitizedTranscript: "recoverable raw text",
        postProcessMetadata: {},
        warnings: ["LLM unavailable"],
      },
    );

    expect(mocks.updateTranscription).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "stable-id",
        rawTranscript: "recoverable raw text",
        transcript: "recoverable raw text",
      }),
    );
    expect(completed).toEqual(
      expect.objectContaining({
        id: "stable-id",
        rawTranscript: "recoverable raw text",
        transcript: "recoverable raw text",
        warnings: ["provider warning", "LLM unavailable"],
      }),
    );
    expect(mocks.addWords).toHaveBeenCalledTimes(1);
    expect(mocks.addWords).toHaveBeenCalledWith(3);
  });

  it("preserves audio and accumulates a failure warning on the same row", async () => {
    const initial = makeTranscription({ warnings: ["configuration warning"] });

    const failed = await checkpointTranscriptionFailure(initial, [
      "invalid API key",
    ]);

    expect(failed).toEqual(
      expect.objectContaining({
        id: "stable-id",
        audio: audioSnapshot,
        warnings: ["configuration warning", "invalid API key"],
      }),
    );
    expect(mocks.createTranscription).not.toHaveBeenCalled();
  });

  it("does not persist incognito recordings but preserves its stats preference", async () => {
    mocks.state.userPrefs.incognitoModeEnabled = true;
    mocks.state.userPrefs.incognitoModeIncludeInStats = true;

    const lifecycle = await beginRecordingLifecycle(audio);
    await completeTranscriptionLifecycle(lifecycle, {
      transcript: "private words",
      sanitizedTranscript: "private words",
      postProcessMetadata: {},
      warnings: [],
    });

    expect(lifecycle).toEqual({ transcription: null, trackWordStats: true });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.createTranscription).not.toHaveBeenCalled();
    expect(mocks.addWords).toHaveBeenCalledWith(2);
  });

  it("skips persistence, retention, and stats for invalid audio", async () => {
    const lifecycle = await beginRecordingLifecycle({
      samples: [],
      sampleRate: 16_000,
    });
    await completeTranscriptionLifecycle(lifecycle, {
      transcript: "unexpected text",
      sanitizedTranscript: null,
      postProcessMetadata: {},
      warnings: [],
    });

    expect(lifecycle).toEqual({ transcription: null, trackWordStats: false });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.purgeStaleAudio).not.toHaveBeenCalled();
    expect(mocks.addWords).not.toHaveBeenCalled();
  });
});
