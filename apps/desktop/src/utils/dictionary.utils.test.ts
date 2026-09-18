import type { Term } from "@voquill/types";
import { describe, expect, it } from "vitest";
import { termsToText } from "./dictionary.utils";

const term = (sourceValue: string, destinationValue = ""): Term => ({
  id: sourceValue,
  createdAt: "2026-01-01T00:00:00.000Z",
  sourceValue,
  destinationValue,
  isReplacement: destinationValue.length > 0,
});

describe("termsToText", () => {
  it("writes one term per line in the given order", () => {
    expect(termsToText([term("思源笔记"), term("Voquill")])).toBe(
      "思源笔记\nVoquill\n",
    );
  });

  it("skips terms without text", () => {
    expect(termsToText([term("   "), term("Voquill")])).toBe("Voquill\n");
  });

  it("exports the original text of a replacement rule", () => {
    expect(termsToText([term("teh", "the")])).toBe("teh\n");
  });

  it("produces an empty file when there are no terms", () => {
    expect(termsToText([])).toBe("");
  });
});
