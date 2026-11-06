import { isAbsolute } from "@tauri-apps/api/path";
import { relaunch } from "@tauri-apps/plugin-process";
import { getIntl } from "../i18n";
import { CPU_DEVICE_VALUE } from "../types/ai.types";
import {
  createEmptyLocalTranscriptionModelStatusMap,
  type LocalTranscriptionModelStatusMap,
} from "../state/settings.state";
import { getAppState, produceAppState } from "../store";
import {
  getLocalTranscriptionSidecarManager,
  type LocalSidecarDevice,
} from "../sidecars";
import {
  getIsModelFolderChangeBlocked,
  LOCAL_MODELS,
  type LocalModelId,
  normalizeTranscriptionDevice,
} from "../utils/local-transcription.utils";
import { getEffectiveTranscriptionMode } from "../utils/user.utils";
import { showErrorSnackbar } from "./app.actions";
import {
  setPreferredTranscriptionDevice,
  updateUserPreferences,
} from "./user.actions";

export const setPreferredModelsDir = async (
  modelsDir: string | null,
): Promise<void> => {
  const normalized = modelsDir?.trim() ? modelsDir.trim() : null;
  const state = getAppState();
  if (normalized === state.settings.aiTranscription.modelsDir) {
    return;
  }
  if (getIsModelFolderChangeBlocked(state)) {
    throw new Error(
      getIntl().formatMessage({
        defaultMessage:
          "Finish recording, transcription, and model downloads or deletions before changing the model folder.",
      }),
    );
  }

  produceAppState((draft) => {
    draft.settings.aiTranscription.modelsDirChangeStatus = "saving";
  });

  try {
    if (normalized !== null && !(await isAbsolute(normalized))) {
      throw new Error(
        getIntl().formatMessage({
          defaultMessage:
            "Enter a full model folder path, such as D:/Models, or leave it empty to use the default folder.",
        }),
      );
    }
    await updateUserPreferences((preferences) => {
      preferences.modelsDir = normalized;
    });
  } catch (error) {
    produceAppState((draft) => {
      draft.settings.aiTranscription.modelsDirChangeStatus = null;
    });
    throw error;
  }

  produceAppState((draft) => {
    draft.settings.aiTranscription.modelsDirChangeStatus = "restart-required";
  });
  await relaunch();
};

const resolvePreferredDevice = (
  currentDevice: string,
  devices: LocalSidecarDevice[],
  deviceChosen: boolean,
): string => {
  const firstCpuDevice = devices.find((device) => device.mode === "cpu")?.id;
  const firstGpuDevice = devices.find((device) => device.mode === "gpu")?.id;

  if (!deviceChosen && firstGpuDevice) {
    return firstGpuDevice;
  }

  const normalizedCurrent = normalizeTranscriptionDevice(currentDevice);
  if (devices.some((device) => device.id === normalizedCurrent)) {
    return normalizedCurrent;
  }

  if (normalizedCurrent.startsWith("gpu")) {
    return firstGpuDevice ?? firstCpuDevice ?? CPU_DEVICE_VALUE;
  }

  return firstCpuDevice ?? firstGpuDevice ?? CPU_DEVICE_VALUE;
};

export const refreshLocalTranscriptionDevices = async ({
  showErrors = true,
}: {
  showErrors?: boolean;
} = {}): Promise<LocalSidecarDevice[] | null> => {
  const state = getAppState();
  if (getEffectiveTranscriptionMode(state) !== "local") {
    return null;
  }

  produceAppState((draft) => {
    draft.settings.aiTranscription.availableDevicesLoading = true;
  });

  try {
    const sidecarManager = getLocalTranscriptionSidecarManager();
    const devices = await sidecarManager.listAvailableDevices();
    const resolvedDevice = resolvePreferredDevice(
      state.settings.aiTranscription.device,
      devices,
      state.settings.aiTranscription.deviceChosen,
    );

    produceAppState((draft) => {
      draft.settings.aiTranscription.availableDevices = devices;
    });

    if (resolvedDevice !== state.settings.aiTranscription.device) {
      await setPreferredTranscriptionDevice(resolvedDevice);
    }

    return devices;
  } catch (error) {
    produceAppState((draft) => {
      draft.settings.aiTranscription.availableDevices = [];
    });

    if (showErrors) {
      showErrorSnackbar(`Unable to load local devices: ${error}`);
    }

    return null;
  } finally {
    produceAppState((draft) => {
      draft.settings.aiTranscription.availableDevicesLoading = false;
    });
  }
};

export const refreshLocalTranscriptionModelStatuses = async ({
  showErrors = true,
}: {
  showErrors?: boolean;
} = {}): Promise<LocalTranscriptionModelStatusMap | null> => {
  const state = getAppState();
  if (getEffectiveTranscriptionMode(state) !== "local") {
    return null;
  }

  const sidecarManager = getLocalTranscriptionSidecarManager();

  produceAppState((draft) => {
    draft.settings.aiTranscription.localModelManagement.modelStatusesLoading = true;
  });

  try {
    const statuses = await sidecarManager.listModelStatuses({
      validate: true,
      models: LOCAL_MODELS,
    });

    produceAppState((draft) => {
      draft.settings.aiTranscription.localModelManagement.modelStatuses =
        statuses;
      draft.settings.aiTranscription.localModelManagement.modelStatusesLoaded = true;
    });

    return statuses;
  } catch (error) {
    produceAppState((draft) => {
      draft.settings.aiTranscription.localModelManagement.modelStatuses =
        createEmptyLocalTranscriptionModelStatusMap();
      draft.settings.aiTranscription.localModelManagement.modelStatusesLoaded = false;
    });

    if (showErrors) {
      showErrorSnackbar(`Unable to load local model status: ${error}`);
    }
    return null;
  } finally {
    produceAppState((draft) => {
      draft.settings.aiTranscription.localModelManagement.modelStatusesLoading = false;
    });
  }
};

export const downloadLocalTranscriptionModel = async (
  model: LocalModelId,
): Promise<void> => {
  const state = getAppState();
  if (getEffectiveTranscriptionMode(state) !== "local") {
    return;
  }

  if (
    state.settings.aiTranscription.localModelManagement.downloadingModels.includes(
      model,
    )
  ) {
    return;
  }

  produceAppState((draft) => {
    draft.settings.aiTranscription.localModelManagement.downloadingModels.push(
      model,
    );
  });
  const sidecarManager = getLocalTranscriptionSidecarManager();

  try {
    await sidecarManager.downloadModel({
      model,
      onProgress: (snapshot) => {
        produceAppState((draft) => {
          draft.settings.aiTranscription.localModelManagement.modelDownloads[
            model
          ] = snapshot;
        });
      },
    });
    await refreshLocalTranscriptionModelStatuses({ showErrors: false });
  } catch (error) {
    showErrorSnackbar(`Unable to download '${model}' model: ${error}`);
  } finally {
    produceAppState((draft) => {
      const management = draft.settings.aiTranscription.localModelManagement;
      management.downloadingModels = management.downloadingModels.filter(
        (downloadingModel) => downloadingModel !== model,
      );
      delete management.modelDownloads[model];
    });
  }
};

export const deleteLocalTranscriptionModel = async (
  model: LocalModelId,
): Promise<LocalTranscriptionModelStatusMap | null> => {
  const state = getAppState();
  if (getEffectiveTranscriptionMode(state) !== "local") {
    return null;
  }

  if (state.settings.aiTranscription.localModelManagement.modelDeletes[model]) {
    return null;
  }

  const sidecarManager = getLocalTranscriptionSidecarManager();

  produceAppState((draft) => {
    draft.settings.aiTranscription.localModelManagement.modelDeletes[model] =
      true;
  });

  try {
    await sidecarManager.deleteModel({ model });
    return await refreshLocalTranscriptionModelStatuses({ showErrors: false });
  } catch (error) {
    showErrorSnackbar(`Unable to delete '${model}' model: ${error}`);
    return null;
  } finally {
    produceAppState((draft) => {
      draft.settings.aiTranscription.localModelManagement.modelDeletes[model] =
        false;
    });
  }
};
