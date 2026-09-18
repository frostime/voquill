import type { Term } from "@voquill/types";

export const termsToText = (terms: readonly Term[]): string => {
  const lines = terms
    .map((term) => term.sourceValue.trim())
    .filter((value) => value.length > 0);

  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
};
