import { describe, expect, it } from "vitest";

import {
  getTranscriptionSidecarDeviceId,
  isGpuPreferredTranscriptionDevice,
  normalizeTranscriptionDevice,
  normalizeLocalModelId,
  supportsGpuTranscriptionDevice,
} from "./local-transcription.utils";

describe("local-transcription-sidecar manager helpers", () => {
  it("normalizes model values to supported sidecar models", () => {
    expect(normalizeLocalModelId("tiny")).toBe("tiny");
    expect(normalizeLocalModelId("tiny.en")).toBe("tiny");
    expect(normalizeLocalModelId("base")).toBe("base");
    expect(normalizeLocalModelId("base.en")).toBe("base");
    expect(normalizeLocalModelId("small")).toBe("small");
    expect(normalizeLocalModelId("small.en")).toBe("small");
    expect(normalizeLocalModelId("medium")).toBe("medium");
    expect(normalizeLocalModelId("medium.en")).toBe("medium");
    expect(normalizeLocalModelId("large-turbo")).toBe("turbo");
    expect(normalizeLocalModelId("large-v3")).toBe("large");
    expect(normalizeLocalModelId("large")).toBe("large");
    expect(normalizeLocalModelId("qwen3-asr-0.6b")).toBe("qwen3-asr-0.6b");
    expect(normalizeLocalModelId("qwen3_asr06_b")).toBe("qwen3-asr-0.6b");
    expect(normalizeLocalModelId("Qwen3-ASR")).toBe("qwen3-asr-0.6b");
  });

  it("defaults unknown model values to tiny", () => {
    expect(normalizeLocalModelId("unknown")).toBe("tiny");
    expect(normalizeLocalModelId(null)).toBe("tiny");
  });

  it("treats any non-cpu device value as gpu preference on supported OSes", () => {
    expect(isGpuPreferredTranscriptionDevice("cpu")).toBe(false);
    expect(isGpuPreferredTranscriptionDevice("cpu:0")).toBe(false);
    expect(isGpuPreferredTranscriptionDevice("gpu")).toBe(true);
    expect(isGpuPreferredTranscriptionDevice("gpu:0")).toBe(true);
    expect(isGpuPreferredTranscriptionDevice("gpu-0")).toBe(true);
  });

  it("advertises GPU selection support", () => {
    expect(supportsGpuTranscriptionDevice()).toBe(true);
  });

  it("normalizes transcription devices while preserving concrete IDs", () => {
    expect(normalizeTranscriptionDevice("cpu")).toBe("cpu");
    expect(normalizeTranscriptionDevice("cpu:0")).toBe("cpu:0");
    expect(normalizeTranscriptionDevice("gpu")).toBe("gpu");
    expect(normalizeTranscriptionDevice("gpu:2")).toBe("gpu:2");
    expect(normalizeTranscriptionDevice("gpu-2")).toBe("gpu:2");
    expect(normalizeTranscriptionDevice("unknown")).toBe("cpu");
  });

  it("extracts sidecar device IDs only for concrete selections", () => {
    expect(getTranscriptionSidecarDeviceId("cpu")).toBeUndefined();
    expect(getTranscriptionSidecarDeviceId("gpu")).toBeUndefined();
    expect(getTranscriptionSidecarDeviceId("cpu:0")).toBe("cpu:0");
    expect(getTranscriptionSidecarDeviceId("gpu:1")).toBe("gpu:1");
  });
});
