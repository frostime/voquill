import { Nullable } from "@voquill/types";
import { dedup } from "@voquill/utilities";
import { getGenerateTextRepo, getTranscribeAudioRepo } from "../repos";
import { getAppState } from "../store";
import { PostProcessingMode, TranscriptionMode } from "../types/ai.types";
import { AudioSamples } from "../types/audio.types";
import {
  extractJsonFromMarkdown,
  unwrapNestedLlmResponse,
} from "../utils/ai.utils";
import {
  coerceToDictationLanguage,
  mapDictationLanguageToWhisperLanguage,
} from "../utils/language.utils";
import { getLogger } from "../utils/log.utils";
import {
  buildLocalizedTranscriptionPrompt,
  buildPostProcessingPrompt,
  buildSystemPostProcessingTonePrompt,
  collectDictionaryEntries,
  PostProcessingPromptInput,
  PROCESSED_TRANSCRIPTION_JSON_SCHEMA,
  PROCESSED_TRANSCRIPTION_SCHEMA,
} from "../utils/prompt.utils";
import { getToneById, getToneConfig } from "../utils/tone.utils";
import {
  getMyUserName,
  loadMyEffectiveDictationLanguage,
} from "../utils/user.utils";

export type TranscribeAudioInput = {
  samples: AudioSamples;
  sampleRate: number;
  dictationLanguage?: string;
};

export type TranscribeAudioMetadata = {
  modelSize?: string | null;
  inferenceDevice?: string | null;
  transcriptionPrompt?: string | null;
  transcriptionApiKeyId?: string | null;
  transcriptionMode?: TranscriptionMode | null;
  transcriptionDurationMs?: number | null;
};

export type TranscribeAudioResult = {
  rawTranscript: string;
  warnings: string[];
  metadata: TranscribeAudioMetadata;
};

export type PostProcessInput = {
  rawTranscript: string;
  toneId: Nullable<string>;
  dictationLanguage?: string;
};

export type PostProcessMetadata = {
  postProcessPrompt?: string | null;
  postProcessApiKeyId?: string | null;
  postProcessMode?: PostProcessingMode | null;
  postProcessDevice?: string | null;
  postprocessDurationMs?: number | null;
};

export type PostProcessResult = {
  transcript: string;
  warnings: string[];
  metadata: PostProcessMetadata;
};

// Combined metadata type for storage compatibility
export type TranscriptionMetadata = TranscribeAudioMetadata &
  PostProcessMetadata & {
    rawTranscript?: string | null;
  };

/**
 * Transcribe audio samples to text.
 * This is the first step - just converts audio to raw transcript.
 */
export const transcribeAudio = async ({
  samples,
  sampleRate,
  dictationLanguage: dictationLanguageOverride,
}: TranscribeAudioInput): Promise<TranscribeAudioResult> => {
  const state = getAppState();

  const metadata: TranscribeAudioMetadata = {};
  const warnings: string[] = [];

  const {
    repo: transcribeRepo,
    apiKeyId: transcriptionApiKeyId,
    warnings: transcribeWarnings,
  } = getTranscribeAudioRepo();
  warnings.push(...transcribeWarnings);

  const dictationLanguage = dictationLanguageOverride
    ? coerceToDictationLanguage(dictationLanguageOverride)
    : await loadMyEffectiveDictationLanguage(state);
  const whisperLanguage =
    mapDictationLanguageToWhisperLanguage(dictationLanguage);

  getLogger().verbose(
    `Transcribing audio: language=${dictationLanguage}, whisper=${whisperLanguage}, sampleRate=${sampleRate}`,
  );

  const dictionaryEntries = collectDictionaryEntries(state);
  const transcriptionPrompt = buildLocalizedTranscriptionPrompt({
    entries: dictionaryEntries,
    dictationLanguage,
    state,
  });

  getLogger().verbose(
    `Transcription prompt: ${transcriptionPrompt.length} chars, apiKeyId=${transcriptionApiKeyId ?? "none"}`,
  );

  const transcribeStart = performance.now();
  const transcribeOutput = await transcribeRepo.transcribeAudio({
    samples,
    sampleRate,
    prompt: transcriptionPrompt,
    language: whisperLanguage,
  });
  const transcribeDuration = performance.now() - transcribeStart;
  const rawTranscript = transcribeOutput.text.trim();

  getLogger().info(
    `Transcription complete in ${Math.round(transcribeDuration)}ms (${rawTranscript.length} chars, mode=${transcribeOutput.metadata?.transcriptionMode ?? "unknown"})`,
  );

  metadata.modelSize =
    transcribeOutput.metadata?.modelSize ||
    state.settings.aiTranscription.modelSize ||
    null;
  metadata.inferenceDevice = transcribeOutput.metadata?.inferenceDevice || null;
  metadata.transcriptionDurationMs = Math.round(transcribeDuration);
  metadata.transcriptionPrompt = transcriptionPrompt;
  metadata.transcriptionApiKeyId = transcriptionApiKeyId;
  metadata.transcriptionMode =
    transcribeOutput.metadata?.transcriptionMode || null;

  if (warnings.length > 0) {
    getLogger().warning(`Transcription warnings: ${warnings.join("; ")}`);
  }

  return {
    rawTranscript,
    warnings: dedup(warnings),
    metadata,
  };
};

/**
 * Post-process a raw transcript using LLM.
 * This is the second step - cleans up and formats the transcript based on tone.
 */
export const postProcessTranscript = async ({
  rawTranscript,
  toneId,
  dictationLanguage: dictationLanguageOverride,
}: PostProcessInput): Promise<PostProcessResult> => {
  const state = getAppState();

  const metadata: PostProcessMetadata = {};
  const warnings: string[] = [];

  const {
    repo: genRepo,
    apiKeyId: genApiKeyId,
    warnings: genWarnings,
  } = getGenerateTextRepo();
  warnings.push(...genWarnings);

  const tone = getToneById(state, toneId);
  const toneProcessingDisabled = tone?.shouldDisablePostProcessing ?? false;
  const enterpriseProcessingDisabled =
    state.enterpriseConfig?.allowPostProcessing === false;

  let processedTranscript = rawTranscript;
  if (toneProcessingDisabled || enterpriseProcessingDisabled) {
    getLogger().info(`Post-processing disabled for tone=${toneId}`);
    metadata.postProcessMode = "none";
  } else if (genRepo) {
    getLogger().verbose(
      `Post-processing with tone=${toneId ?? "default"}, apiKeyId=${genApiKeyId ?? "none"}`,
    );
    const dictationLanguage = dictationLanguageOverride
      ? coerceToDictationLanguage(dictationLanguageOverride)
      : await loadMyEffectiveDictationLanguage(state);
    const toneConfig = getToneConfig(state, toneId);
    getLogger().verbose(
      "Post-process language:",
      dictationLanguage,
      "toneName:",
      tone?.name ?? "unknown",
    );

    const promptInput: PostProcessingPromptInput = {
      transcript: rawTranscript,
      userName: getMyUserName(state),
      dictationLanguage,
      tone: toneConfig,
    };
    const ppSystem = buildSystemPostProcessingTonePrompt(promptInput);
    const ppPrompt = buildPostProcessingPrompt(promptInput);
    getLogger().verbose(
      "Post-process prompt length:",
      ppPrompt.length,
      "system length:",
      ppSystem.length,
    );

    const postprocessStart = performance.now();
    getLogger().verbose("Calling LLM for post-processing");
    const genOutput = await genRepo.generateText({
      system: ppSystem,
      prompt: ppPrompt,
      jsonResponse: {
        name: "transcription_cleaning",
        description: "JSON response with the processed transcription",
        schema: PROCESSED_TRANSCRIPTION_JSON_SCHEMA,
      },
    });
    const postprocessDuration = performance.now() - postprocessStart;
    metadata.postprocessDurationMs = Math.round(postprocessDuration);

    getLogger().info(
      `Post-processing complete in ${Math.round(postprocessDuration)}ms`,
    );
    getLogger().verbose("LLM raw output length:", genOutput.text.length);

    try {
      const extractedJson = extractJsonFromMarkdown(genOutput.text);
      const parsed = unwrapNestedLlmResponse(
        JSON.parse(extractedJson),
        "processedTranscription",
      );

      const validationResult = PROCESSED_TRANSCRIPTION_SCHEMA.safeParse(parsed);
      if (!validationResult.success) {
        getLogger().warning(
          "Post-processing validation failed:",
          validationResult.error.message,
        );
        warnings.push(
          `Post-processing response validation failed: ${validationResult.error.message}`,
        );
      } else {
        processedTranscript = validationResult.data.result.trim();
        getLogger().verbose(
          "Processed transcript length:",
          processedTranscript.length,
        );
      }
    } catch (e) {
      getLogger().error("Failed to parse post-processing response:", e);
      warnings.push(
        `Failed to parse post-processing response: ${(e as Error).message}`,
      );
    }

    metadata.postProcessPrompt = ppPrompt;
    metadata.postProcessApiKeyId = genApiKeyId;
    metadata.postProcessMode = genOutput.metadata?.postProcessingMode || null;
    metadata.postProcessDevice = genOutput.metadata?.inferenceDevice || null;
    getLogger().verbose(
      "Post-process mode:",
      metadata.postProcessMode,
      "device:",
      metadata.postProcessDevice,
    );
  } else {
    getLogger().info("No post-processing repo configured, skipping");
    metadata.postProcessMode = "none";
  }

  return {
    transcript: processedTranscript,
    warnings: dedup(warnings),
    metadata,
  };
};
