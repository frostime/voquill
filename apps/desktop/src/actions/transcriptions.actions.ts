import { getRec } from "@voquill/utilities";
import { getTranscriptionRepo } from "../repos";
import { getAppState, produceAppState } from "../store";
import {
  applyReplacements,
  applySymbolConversions,
} from "../utils/string.utils";
import {
  checkpointRawTranscription,
  checkpointTranscriptionFailure,
  completeRetranscription,
  getTranscriptionFailureWarning,
} from "./transcription-lifecycle.actions";
import { postProcessTranscript, transcribeAudio } from "./transcribe.actions";

export const openTranscriptionDetailsDialog = (transcriptionId: string) => {
  produceAppState((draft) => {
    draft.transcriptions.detailsDialogTranscriptionId = transcriptionId;
    draft.transcriptions.detailsDialogOpen = true;
  });
};

export const closeTranscriptionDetailsDialog = () => {
  produceAppState((draft) => {
    draft.transcriptions.detailsDialogOpen = false;
  });
};

export const openRetranscribeDialog = (transcriptionId: string) => {
  produceAppState((draft) => {
    draft.transcriptions.retranscribeDialogTranscriptionId = transcriptionId;
    draft.transcriptions.retranscribeDialogOpen = true;
  });
};

export const closeRetranscribeDialog = () => {
  produceAppState((draft) => {
    draft.transcriptions.retranscribeDialogOpen = false;
  });
};

export const openFlagTranscriptionDialog = (transcriptionId: string) => {
  produceAppState((draft) => {
    draft.transcriptions.flagDialogTranscriptionId = transcriptionId;
    draft.transcriptions.flagDialogOpen = true;
  });
};

export const closeFlagTranscriptionDialog = () => {
  produceAppState((draft) => {
    draft.transcriptions.flagDialogOpen = false;
  });
};

type RetranscribeTranscriptionParams = {
  transcriptionId: string;
  toneId?: string | null;
  languageCode?: string | null;
};

export const retranscribeTranscription = async ({
  transcriptionId,
  toneId,
  languageCode,
}: RetranscribeTranscriptionParams): Promise<void> => {
  const state = getAppState();
  const transcription = getRec(state.transcriptionById, transcriptionId);

  if (!transcription) {
    throw new Error("Transcription not found.");
  }

  const repo = getTranscriptionRepo();
  const audioData = await repo.loadTranscriptionAudio(transcriptionId);

  let transcribeResult;
  try {
    transcribeResult = await transcribeAudio({
      samples: audioData.samples,
      sampleRate: audioData.sampleRate,
      dictationLanguage: languageCode ?? undefined,
    });
  } catch (error) {
    await checkpointTranscriptionFailure(transcription, [
      getTranscriptionFailureWarning(error),
    ]);
    throw error;
  }

  const rawTranscript = transcribeResult.rawTranscript.trim();
  if (!rawTranscript) {
    await checkpointTranscriptionFailure(transcription, [
      ...transcribeResult.warnings,
      "Retranscription produced no text.",
    ]);
    throw new Error("Retranscription produced no text.");
  }

  let checkpointed = await checkpointRawTranscription(transcription, {
    rawTranscript,
    metadata: transcribeResult.metadata,
    warnings: transcribeResult.warnings,
  });

  const replacementRules = Object.values(state.termById)
    .filter((term) => term.isReplacement)
    .map((term) => ({
      sourceValue: term.sourceValue,
      destinationValue: term.destinationValue,
    }));

  const afterReplacements = applyReplacements(rawTranscript, replacementRules);
  const sanitizedTranscript = applySymbolConversions(afterReplacements);

  let postProcessResult;
  try {
    postProcessResult = await postProcessTranscript({
      rawTranscript: sanitizedTranscript,
      toneId: toneId ?? null,
      dictationLanguage: languageCode ?? undefined,
    });
  } catch (error) {
    checkpointed =
      (await checkpointTranscriptionFailure(checkpointed, [
        getTranscriptionFailureWarning(error),
      ])) ?? checkpointed;
    throw error;
  }

  await completeRetranscription(checkpointed, {
    transcript: postProcessResult.transcript,
    sanitizedTranscript,
    postProcessMetadata: postProcessResult.metadata,
    warnings: postProcessResult.warnings,
  });
};
