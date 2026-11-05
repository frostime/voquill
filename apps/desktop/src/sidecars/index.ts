import {
  supportsGpuTranscriptionDevice,
  type LocalModelId,
  LOCAL_MODELS,
} from "../utils/local-transcription.utils";
import { getLogger } from "../utils/log.utils";
import {
  LocalTranscriptionSidecar,
  SidecarRequestError,
  type LocalSidecarDevice,
  type LocalSidecarDownloadSnapshot,
  type LocalSidecarModelStatus,
  type LocalSidecarStreamingSession,
  type LocalSidecarStreamingSessionInput,
  type LocalSidecarTranscribeInput,
  type LocalSidecarTranscribeOutput,
} from "./local-transcription.sidecar";
import { toErrorMessage } from "./sidecar.utils";

export type {
  LocalSidecarDevice,
  LocalSidecarDownloadSnapshot,
  LocalSidecarModelStatus,
  LocalSidecarStreamingSession,
  LocalSidecarStreamingSessionInput,
  LocalSidecarTranscribeInput,
  LocalSidecarTranscribeOutput,
} from "./local-transcription.sidecar";

class LocalTranscriptionSidecarFacade {
  private cpuSidecar = new LocalTranscriptionSidecar("cpu");
  private gpuSidecar = new LocalTranscriptionSidecar("gpu");
  private gpuUnavailable = false;

  async listAvailableDevices(): Promise<LocalSidecarDevice[]> {
    await this.cpuSidecar.ensureStarted();
    const cpuDevices = await this.cpuSidecar.listDevices();
    const devices = [...cpuDevices];

    if (supportsGpuTranscriptionDevice() && !this.gpuUnavailable) {
      try {
        await this.gpuSidecar.ensureStarted();
        const gpuDevices = await this.gpuSidecar.listDevices();
        devices.push(...gpuDevices);
      } catch (error) {
        this.markGpuUnavailable(error);
      }
    }

    return devices;
  }

  // Model management always runs on the CPU sidecar: both binaries share one
  // models directory, and two download registries would race over it.
  async listModelStatuses({
    validate = true,
    models = LOCAL_MODELS,
  }: {
    validate?: boolean;
    models?: LocalModelId[];
  }): Promise<Record<LocalModelId, LocalSidecarModelStatus>> {
    await this.cpuSidecar.ensureStarted();
    return await this.cpuSidecar.listModelStatuses(models, validate);
  }

  async getModelStatus({
    model,
    validate = true,
  }: {
    model: LocalModelId;
    validate?: boolean;
  }): Promise<LocalSidecarModelStatus> {
    await this.cpuSidecar.ensureStarted();
    return await this.cpuSidecar.getModelStatus(model, validate);
  }

  async downloadModel({
    model,
    onProgress,
  }: {
    model: LocalModelId;
    onProgress?: (snapshot: LocalSidecarDownloadSnapshot) => void;
  }): Promise<LocalSidecarModelStatus> {
    await this.cpuSidecar.ensureStarted();
    return await this.cpuSidecar.downloadModel(model, onProgress);
  }

  async deleteModel({
    model,
  }: {
    model: LocalModelId;
  }): Promise<LocalSidecarModelStatus> {
    await this.cpuSidecar.ensureStarted();
    const result = await this.cpuSidecar.deleteModel(model);
    this.gpuSidecar.invalidateModelReadiness(model);
    return result;
  }

  async resetModelsDir(): Promise<void> {
    this.gpuUnavailable = false;
    await Promise.all([
      this.cpuSidecar.resetModelsDir(),
      this.gpuSidecar.resetModelsDir(),
    ]);
  }

  async transcribe(
    input: LocalSidecarTranscribeInput,
  ): Promise<LocalSidecarTranscribeOutput> {
    const sidecar = await this.resolveRuntime(input.preferGpu);

    try {
      return await sidecar.transcribe(input);
    } catch (error) {
      if (
        input.preferGpu &&
        sidecar === this.gpuSidecar &&
        this.shouldFallbackToCpu(error)
      ) {
        this.markGpuUnavailable(error);
        return await this.cpuSidecar.transcribe({
          ...input,
          deviceId: undefined,
        });
      }

      throw error;
    }
  }

  async createStreamingSession(
    input: LocalSidecarStreamingSessionInput,
  ): Promise<LocalSidecarStreamingSession> {
    const sidecar = await this.resolveRuntime(input.preferGpu);

    try {
      return await sidecar.createStreamingSession(input);
    } catch (error) {
      if (
        input.preferGpu &&
        sidecar === this.gpuSidecar &&
        this.shouldFallbackToCpu(error)
      ) {
        this.markGpuUnavailable(error);
        return await this.cpuSidecar.createStreamingSession({
          ...input,
          deviceId: undefined,
        });
      }

      throw error;
    }
  }

  private async resolveRuntime(
    preferGpu: boolean,
  ): Promise<LocalTranscriptionSidecar> {
    if (preferGpu && !this.gpuUnavailable) {
      try {
        await this.gpuSidecar.ensureStarted();
        return this.gpuSidecar;
      } catch (error) {
        this.markGpuUnavailable(error);
      }
    }

    await this.cpuSidecar.ensureStarted();
    return this.cpuSidecar;
  }

  private shouldFallbackToCpu(error: unknown): boolean {
    if (error instanceof SidecarRequestError) {
      return error.status === undefined;
    }

    const message = toErrorMessage(error).toLowerCase();
    return message.includes("sidecar") || message.includes("request failed");
  }

  private markGpuUnavailable(error: unknown): void {
    this.gpuUnavailable = true;
    getLogger().warning(
      `[local-sidecar:gpu] unavailable, falling back to CPU (${toErrorMessage(error)})`,
    );
  }
}

let localTranscriptionFacade: LocalTranscriptionSidecarFacade | null = null;

export const getLocalTranscriptionSidecarManager =
  (): LocalTranscriptionSidecarFacade => {
    localTranscriptionFacade ??= new LocalTranscriptionSidecarFacade();
    return localTranscriptionFacade;
  };
