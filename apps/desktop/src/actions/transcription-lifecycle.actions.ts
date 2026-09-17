import { invoke } from "@tauri-apps/api/core";
import type { Transcription, TranscriptionAudioSnapshot } from "@voquill/types";
import { countWords, dedup } from "@voquill/utilities";
import dayjs from "dayjs";
import { getTranscriptionRepo } from "../repos";
import { getAppState, produceAppState } from "../store";
import type { StopRecordingResponse } from "../types/transcription-session.types";
import { createId } from "../utils/id.utils";
import { getLogger } from "../utils/log.utils";
import { getMyEffectiveUserId } from "../utils/user.utils";
import { showErrorSnackbar } from "./app.actions";
import type {
  PostProcessMetadata,
  TranscribeAudioMetadata,
} from "./transcribe.actions";
import { addWordsToCurrentUser } from "./user.actions";

export type RecordingLifecycle = {
  transcription: Transcription | null;
  trackWordStats: boolean;
};

type RawTranscriptionCheckpoint = {
  rawTranscript: string;
  metadata: TranscribeAudioMetadata;
  warnings: string[];
};

type CompletedTranscriptionCheckpoint = {
  transcript: string | null;
  sanitizedTranscript: string | null;
  postProcessMetadata: PostProcessMetadata;
  warnings: string[];
  remoteStatus?: "sent" | "received" | null;
  remoteDeviceId?: string | null;
};

const getSampleCount = (samples: StopRecordingResponse["samples"]): number =>
  typeof samples?.length === "number" ? samples.length : 0;

const syncTranscription = (transcription: Transcription): void => {
  produceAppState((draft) => {
    draft.transcriptionById[transcription.id] = transcription;
    draft.transcriptions.transcriptionIds = [
      transcription.id,
      ...draft.transcriptions.transcriptionIds.filter(
        (id) => id !== transcription.id,
      ),
    ];
  });
};

const updateTranscription = async (
  transcription: Transcription,
): Promise<Transcription> => {
  try {
    const updated =
      await getTranscriptionRepo().updateTranscription(transcription);
    syncTranscription(updated);
    return updated;
  } catch (error) {
    getLogger().error(`Failed to update transcription checkpoint: ${error}`);
    showErrorSnackbar("Unable to save transcription progress.");
    throw error;
  }
};

const mergeWarnings = (
  existing: string[] | null | undefined,
  incoming: string[],
): string[] | null => {
  const warnings = dedup([...(existing ?? []), ...incoming].filter(Boolean));
  return warnings.length > 0 ? warnings : null;
};

export const getTranscriptionFailureWarning = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const beginRecordingLifecycle = async (
  audio: StopRecordingResponse,
): Promise<RecordingLifecycle> => {
  const sampleRate = audio.sampleRate;
  const sampleCount = getSampleCount(audio.samples);

  if (sampleRate == null || Number.isNaN(sampleRate)) {
    getLogger().error("Received audio payload without sample rate");
    showErrorSnackbar("Recording missing sample rate. Please try again.");
    return { transcription: null, trackWordStats: false };
  }

  if (sampleRate <= 0 || sampleCount === 0) {
    getLogger().warning(
      `Skipping recording persistence: rate=${sampleRate}, sampleCount=${sampleCount}`,
    );
    return { transcription: null, trackWordStats: false };
  }

  const state = getAppState();
  if (state.userPrefs?.incognitoModeEnabled) {
    return {
      transcription: null,
      trackWordStats: state.userPrefs.incognitoModeIncludeInStats ?? false,
    };
  }

  const id = createId();
  let audioSnapshot: TranscriptionAudioSnapshot;
  try {
    audioSnapshot = await invoke<TranscriptionAudioSnapshot>(
      "store_transcription_audio",
      {
        id,
        samples: Array.from(audio.samples),
        sampleRate,
      },
    );
  } catch (error) {
    getLogger().error(`Failed to persist recording audio: ${error}`);
    showErrorSnackbar("Unable to save recording audio. Processing stopped.");
    throw error;
  }

  const initial: Transcription = {
    id,
    transcript: "",
    createdAt: dayjs().toISOString(),
    createdByUserId: getMyEffectiveUserId(state),
    isDeleted: false,
    audio: audioSnapshot,
    rawTranscript: "",
    warnings: null,
  };

  let stored: Transcription;
  try {
    stored = await getTranscriptionRepo().createTranscription(initial);
  } catch (error) {
    getLogger().error(`Failed to create recording history entry: ${error}`);
    showErrorSnackbar("Unable to save recording history. Processing stopped.");
    throw error;
  }

  syncTranscription(stored);

  try {
    const purgedIds = await getTranscriptionRepo().purgeStaleAudio();
    if (purgedIds.length > 0) {
      produceAppState((draft) => {
        for (const purgedId of purgedIds) {
          const purged = draft.transcriptionById[purgedId];
          if (purged) delete purged.audio;
        }
      });
    }
  } catch (error) {
    getLogger().error(`Failed to purge stale audio snapshots: ${error}`);
  }

  return { transcription: stored, trackWordStats: true };
};

export const checkpointRawTranscription = async (
  transcription: Transcription,
  checkpoint: RawTranscriptionCheckpoint,
): Promise<Transcription> =>
  updateTranscription({
    ...transcription,
    transcript: checkpoint.rawTranscript,
    rawTranscript: checkpoint.rawTranscript,
    sanitizedTranscript: null,
    modelSize: checkpoint.metadata.modelSize ?? null,
    inferenceDevice: checkpoint.metadata.inferenceDevice ?? null,
    transcriptionPrompt: checkpoint.metadata.transcriptionPrompt ?? null,
    postProcessPrompt: null,
    transcriptionApiKeyId: checkpoint.metadata.transcriptionApiKeyId ?? null,
    postProcessApiKeyId: null,
    transcriptionMode: checkpoint.metadata.transcriptionMode ?? null,
    postProcessMode: null,
    postProcessDevice: null,
    transcriptionDurationMs:
      checkpoint.metadata.transcriptionDurationMs ?? null,
    postprocessDurationMs: null,
    warnings: mergeWarnings(transcription.warnings, checkpoint.warnings),
  });

export const checkpointTranscriptionFailure = async (
  transcription: Transcription | null,
  warnings: string[],
): Promise<Transcription | null> => {
  if (!transcription) return null;
  return updateTranscription({
    ...transcription,
    warnings: mergeWarnings(transcription.warnings, warnings),
  });
};

export const completeTranscriptionLifecycle = async (
  lifecycle: RecordingLifecycle,
  checkpoint: CompletedTranscriptionCheckpoint,
): Promise<Transcription | null> => {
  const fallbackTranscript = lifecycle.transcription?.transcript ?? "";
  const transcript = checkpoint.transcript?.trim()
    ? checkpoint.transcript
    : fallbackTranscript;

  let completed = lifecycle.transcription;
  if (completed) {
    completed = await updateTranscription({
      ...completed,
      transcript,
      sanitizedTranscript: checkpoint.sanitizedTranscript,
      postProcessPrompt:
        checkpoint.postProcessMetadata.postProcessPrompt ?? null,
      postProcessApiKeyId:
        checkpoint.postProcessMetadata.postProcessApiKeyId ?? null,
      postProcessMode: checkpoint.postProcessMetadata.postProcessMode ?? null,
      postProcessDevice:
        checkpoint.postProcessMetadata.postProcessDevice ?? null,
      postprocessDurationMs:
        checkpoint.postProcessMetadata.postprocessDurationMs ?? null,
      warnings: mergeWarnings(completed.warnings, checkpoint.warnings),
      remoteStatus: checkpoint.remoteStatus ?? null,
      remoteDeviceId: checkpoint.remoteDeviceId ?? null,
    });
  }

  if (lifecycle.trackWordStats && transcript) {
    const wordCount = countWords(transcript);
    if (wordCount > 0) {
      try {
        await addWordsToCurrentUser(wordCount);
      } catch (error) {
        getLogger().error(`Failed to update usage metrics: ${error}`);
      }
    }
  }

  return completed;
};

export const completeRetranscription = async (
  transcription: Transcription,
  checkpoint: CompletedTranscriptionCheckpoint,
): Promise<Transcription> => {
  const completed = await completeTranscriptionLifecycle(
    { transcription, trackWordStats: false },
    checkpoint,
  );
  return completed as Transcription;
};
