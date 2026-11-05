import type { UserPreferences } from "@voquill/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../state/app.state";

const mocks = vi.hoisted(() => ({
  state: null as unknown as AppState,
  save: vi.fn(),
  isAbsolute: vi.fn(),
  relaunch: vi.fn(),
  download: vi.fn(),
  listStatuses: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({ isAbsolute: mocks.isAbsolute }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("../i18n", () => ({
  getIntl: () => ({
    formatMessage: ({ defaultMessage }: { defaultMessage: string }) =>
      defaultMessage,
  }),
}));
vi.mock("../store", () => ({
  getAppState: () => mocks.state,
  produceAppState: (update: (state: AppState) => void) => update(mocks.state),
}));
vi.mock("../sidecars", () => ({
  getLocalTranscriptionSidecarManager: () => ({
    downloadModel: mocks.download,
    listModelStatuses: mocks.listStatuses,
  }),
}));
vi.mock("../utils/user.utils", () => ({
  getEffectiveTranscriptionMode: () => "local",
}));
vi.mock("./app.actions", () => ({ showErrorSnackbar: vi.fn() }));
vi.mock("./user.actions", () => ({
  setPreferredTranscriptionDevice: vi.fn(),
  updateUserPreferences: async (
    update: (preferences: UserPreferences) => void,
  ) => {
    const preferences = {
      modelsDir: mocks.state.settings.aiTranscription.modelsDir,
    } as UserPreferences;
    update(preferences);
    await mocks.save(preferences);
    mocks.state.settings.aiTranscription.modelsDir = preferences.modelsDir;
  },
}));

import { INITIAL_APP_STATE } from "../state/app.state";
import { createDeferred } from "../sidecars/sidecar.utils";
import {
  downloadLocalTranscriptionModel,
  setPreferredModelsDir,
} from "./settings-local-transcription.actions";

const transcription = () => mocks.state.settings.aiTranscription;

describe("model folder changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state = structuredClone(INITIAL_APP_STATE);
    transcription().modelsDir = "D:/Models";
    mocks.isAbsolute.mockResolvedValue(true);
    mocks.save.mockResolvedValue(undefined);
    mocks.relaunch.mockResolvedValue(undefined);
    mocks.listStatuses.mockResolvedValue({});
  });

  it("saves the confirmed folder before restarting and blocks work throughout the change", async () => {
    const saved = createDeferred<void>();
    mocks.save.mockReturnValue(saved.promise);
    const changing = setPreferredModelsDir("  E:/Models  ");
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(transcription().modelsDirChangeStatus).toBe("saving");
    expect(transcription().modelsDir).toBe("D:/Models");
    expect(mocks.relaunch).not.toHaveBeenCalled();

    saved.resolve();
    await changing;
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ modelsDir: "E:/Models" }),
    );
    expect(transcription().modelsDirChangeStatus).toBe("restart-required");
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "recording",
      (state: AppState) => {
        state.activeRecordingMode = "dictate";
      },
    ],
    [
      "transcribing",
      (state: AppState) => {
        state.overlayPhase = "transcribing";
      },
    ],
    [
      "retranscribing history",
      (state: AppState) => {
        state.transcriptions.retranscribingIds = ["history-id"];
      },
    ],
    [
      "downloading",
      (state: AppState) => {
        state.settings.aiTranscription.localModelManagement.downloadingModels =
          ["tiny"];
      },
    ],
    [
      "deleting",
      (state: AppState) => {
        state.settings.aiTranscription.localModelManagement.modelDeletes.tiny = true;
      },
    ],
  ] as const)("refuses to change folders while %s", async (_name, makeBusy) => {
    makeBusy(mocks.state);
    await expect(setPreferredModelsDir("E:/Models")).rejects.toThrow(/Finish/);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
    expect(transcription().modelsDirChangeStatus).toBeNull();
  });

  it("rejects relative paths without saving or restarting", async () => {
    mocks.isAbsolute.mockResolvedValue(false);
    await expect(setPreferredModelsDir("models/cache")).rejects.toThrow(
      /full model folder path/,
    );
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
    expect(transcription().modelsDirChangeStatus).toBeNull();
  });

  it("does not restart or keep the app blocked when saving fails", async () => {
    mocks.save.mockRejectedValue(new Error("database unavailable"));
    await expect(setPreferredModelsDir("E:/Models")).rejects.toThrow(
      "database unavailable",
    );
    expect(mocks.relaunch).not.toHaveBeenCalled();
    expect(transcription().modelsDir).toBe("D:/Models");
    expect(transcription().modelsDirChangeStatus).toBeNull();
  });

  it("keeps restart mandatory if the restart request fails", async () => {
    mocks.relaunch.mockRejectedValue(new Error("restart unavailable"));
    await expect(setPreferredModelsDir("E:/Models")).rejects.toThrow(
      "restart unavailable",
    );
    expect(transcription().modelsDir).toBe("E:/Models");
    expect(transcription().modelsDirChangeStatus).toBe("restart-required");
    await expect(setPreferredModelsDir("F:/Models")).rejects.toThrow(/Finish/);
  });

  it("uses the default folder for empty input, and leaves an unchanged folder alone", async () => {
    await setPreferredModelsDir(" D:/Models ");
    expect(mocks.save).not.toHaveBeenCalled();
    await setPreferredModelsDir("   ");
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ modelsDir: null }),
    );
    expect(mocks.isAbsolute).not.toHaveBeenCalled();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it("counts a download as busy before its first progress response arrives", async () => {
    const downloaded = createDeferred<void>();
    mocks.download.mockReturnValue(downloaded.promise);
    const downloading = downloadLocalTranscriptionModel("tiny");
    expect(transcription().localModelManagement.downloadingModels).toEqual([
      "tiny",
    ]);
    expect(transcription().localModelManagement.modelDownloads).toEqual({});
    await expect(setPreferredModelsDir("E:/Models")).rejects.toThrow(/Finish/);
    downloaded.resolve();
    await downloading;
    expect(transcription().localModelManagement.downloadingModels).toEqual([]);
  });
});
