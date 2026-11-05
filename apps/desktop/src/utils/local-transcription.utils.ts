import { CPU_DEVICE_VALUE } from "../types/ai.types";

export type LocalModelId =
  | "tiny"
  | "base"
  | "small"
  | "medium"
  | "large"
  | "turbo"
  | "hindi2hinglish"
  | "qwen3-asr-0.6b";

export const DEFAULT_LOCAL_MODEL: LocalModelId = "tiny";
export const LOCAL_MODELS: LocalModelId[] = [
  "tiny",
  "base",
  "small",
  "medium",
  "turbo",
  "large",
  "hindi2hinglish",
  "qwen3-asr-0.6b",
];

export const normalizeLocalModelId = (
  value: string | null | undefined,
): LocalModelId => {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "tiny" || normalized === "tiny.en") {
    return "tiny";
  }

  if (normalized === "base" || normalized === "base.en") {
    return "base";
  }

  if (normalized === "small" || normalized === "small.en") {
    return "small";
  }

  if (normalized === "medium" || normalized === "medium.en") {
    return "medium";
  }

  if (normalized === "large" || normalized === "large-v3") {
    return "large";
  }

  if (
    normalized === "turbo" ||
    normalized === "large-turbo" ||
    normalized === "large_v3_turbo" ||
    normalized === "large-v3-turbo"
  ) {
    return "turbo";
  }

  if (
    normalized === "hindi2hinglish" ||
    normalized === "hindi-hinglish" ||
    normalized === "hindi2hinglish-apex" ||
    normalized === "whisper-hindi2hinglish-apex"
  ) {
    return "hindi2hinglish";
  }

  if (
    normalized === "qwen3-asr-0.6b" ||
    normalized === "qwen3_asr06_b" ||
    normalized === "qwen3-asr" ||
    normalized === "qwen"
  ) {
    return "qwen3-asr-0.6b";
  }

  return DEFAULT_LOCAL_MODEL;
};

export const isGpuPreferredTranscriptionDevice = (
  device: string | null | undefined,
): boolean => {
  const normalized = device?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized === "gpu" ||
    normalized.startsWith("gpu:") ||
    normalized.startsWith("gpu-")
  );
};

export const supportsGpuTranscriptionDevice = (): boolean => true;

export const normalizeTranscriptionDevice = (
  device: string | null | undefined,
): string => {
  const normalized = device?.trim().toLowerCase();
  if (!normalized) {
    return CPU_DEVICE_VALUE;
  }

  const normalizedLegacyGpu = normalized.replace(/^gpu-(\d+)$/, "gpu:$1");
  const normalizedLegacyCpu = normalizedLegacyGpu.replace(
    /^cpu-(\d+)$/,
    "cpu:$1",
  );

  if (
    normalizedLegacyCpu === CPU_DEVICE_VALUE ||
    normalizedLegacyCpu.startsWith("cpu:")
  ) {
    return normalizedLegacyCpu;
  }

  if (normalizedLegacyCpu === "gpu" || normalizedLegacyCpu.startsWith("gpu:")) {
    return normalizedLegacyCpu;
  }

  return CPU_DEVICE_VALUE;
};

export const getTranscriptionSidecarDeviceId = (
  device: string | null | undefined,
): string | undefined => {
  const normalized = normalizeTranscriptionDevice(device);
  return normalized.includes(":") ? normalized : undefined;
};
