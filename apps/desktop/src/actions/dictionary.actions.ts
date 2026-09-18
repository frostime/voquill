import { invoke } from "@tauri-apps/api/core";
import { Term } from "@voquill/types";
import { getRec } from "@voquill/utilities";
import dayjs from "dayjs";
import { getIntl } from "../i18n";
import { getTermRepo } from "../repos";
import { getAppState, produceAppState } from "../store";
import { registerTerms } from "../utils/app.utils";
import { termsToText } from "../utils/dictionary.utils";
import { showErrorSnackbar, showSnackbar } from "./app.actions";

export const loadDictionary = async (): Promise<void> => {
  const terms = await getTermRepo().listTerms();
  const activeTerms = terms.sort(
    (a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf(),
  );

  produceAppState((draft) => {
    registerTerms(draft, terms);
    draft.dictionary.termIds = activeTerms.map((term) => term.id);
  });
};

export const exportDictionary = async (): Promise<void> => {
  const state = getAppState();
  const terms = state.dictionary.termIds
    .map((id) => getRec(state.termById, id))
    .filter((term): term is Term => term !== null);

  try {
    const saved = await invoke<boolean>("export_text_file", {
      fileName: "voquill-dictionary.txt",
      contents: termsToText(terms),
    });

    if (saved) {
      showSnackbar(
        getIntl().formatMessage({
          defaultMessage: "Export saved successfully",
        }),
        { mode: "success" },
      );
    }
  } catch (error) {
    showErrorSnackbar(error);
  }
};
