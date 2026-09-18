import type { AppTarget, Tone, User } from "@voquill/types";
import { describe, expect, it } from "vitest";
import { AppState, INITIAL_APP_STATE } from "../state/app.state";
import {
  getDictationToneId,
  POLISHED_TONE_ID,
  VERBATIM_TONE_ID,
} from "./tone.utils";
import { LOCAL_USER_ID } from "./user.utils";

const APP_TARGET_ID = "chrome";

const makeState = (args: {
  stylingMode: "app" | "manual";
  selectedToneId?: string | null;
  appTargetToneId?: string | null;
}): AppState => ({
  ...INITIAL_APP_STATE,
  userById: {
    [LOCAL_USER_ID]: {
      id: LOCAL_USER_ID,
      stylingMode: args.stylingMode,
      selectedToneId: args.selectedToneId ?? null,
      activeToneIds: [POLISHED_TONE_ID, VERBATIM_TONE_ID],
    } as User,
  },
  toneById: {
    [POLISHED_TONE_ID]: { id: POLISHED_TONE_ID } as Tone,
    [VERBATIM_TONE_ID]: { id: VERBATIM_TONE_ID } as Tone,
  },
  appTargetById: {
    [APP_TARGET_ID]: {
      id: APP_TARGET_ID,
      toneId: args.appTargetToneId ?? null,
    } as AppTarget,
  },
});

describe("getDictationToneId", () => {
  it("uses the manually selected style in manual mode, ignoring the app style", () => {
    const state = makeState({
      stylingMode: "manual",
      selectedToneId: VERBATIM_TONE_ID,
      appTargetToneId: POLISHED_TONE_ID,
    });

    expect(getDictationToneId(state, APP_TARGET_ID)).toBe(VERBATIM_TONE_ID);
  });

  it("uses the style configured for the current app in app mode", () => {
    const state = makeState({
      stylingMode: "app",
      appTargetToneId: VERBATIM_TONE_ID,
    });

    expect(getDictationToneId(state, APP_TARGET_ID)).toBe(VERBATIM_TONE_ID);
  });

  it("resolves to no style in app mode when the app has none", () => {
    const state = makeState({ stylingMode: "app", appTargetToneId: null });

    expect(getDictationToneId(state, APP_TARGET_ID)).toBeNull();
  });

  it("resolves to no style when the dictation has no app target yet", () => {
    const state = makeState({
      stylingMode: "app",
      appTargetToneId: VERBATIM_TONE_ID,
    });

    expect(getDictationToneId(state, null)).toBeNull();
  });
});
