import { afterEach, describe, expect, it, vi } from "vitest";
import {
  geminiGenerateTextResponse,
  openaiGenerateTextResponse,
  openrouterGenerateTextResponse,
} from "@voquill/voice-ai";

type RequestBody = Record<string, unknown>;

const createJsonFetch =
  (bodies: RequestBody[]) =>
  async (
    _input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const body = await new Response(init?.body ?? null).json();
    bodies.push(body as RequestBody);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
        usage: { total_tokens: 1 },
      }),
      { headers: { "content-type": "application/json" } },
    );
  };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("post-processing request options", () => {
  it("merges OpenAI options while preserving application-owned fields", async () => {
    const bodies: RequestBody[] = [];

    await openaiGenerateTextResponse({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      prompt: "Rewrite this",
      requestOptions: {
        temperature: 0.2,
        model: "user-selected-model-must-not-win",
        messages: [],
        stream: true,
        response_format: { type: "json_object" },
      },
      jsonResponse: {
        name: "rewritten_text",
        description: "The rewritten text",
        schema: { type: "object", properties: {} },
      },
      customFetch: createJsonFetch(bodies),
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      temperature: 0.2,
      model: "gpt-4o-mini",
      stream: false,
      messages: [{ role: "user" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "rewritten_text",
          strict: true,
        },
      },
    });
  });

  it("lets raw OpenRouter options override structured provider routing", async () => {
    const bodies: RequestBody[] = [];

    await openrouterGenerateTextResponse({
      apiKey: "test-key",
      model: "openai/gpt-4o-mini",
      prompt: "Rewrite this",
      providerRouting: { order: ["structured-provider"] },
      requestOptions: {
        provider: { order: ["raw-provider"] },
      },
      customFetch: createJsonFetch(bodies),
    });

    expect(bodies[0]?.provider).toEqual({ order: ["raw-provider"] });
  });

  it("places Gemini options in generateContent config", async () => {
    const bodies: RequestBody[] = [];
    vi.stubGlobal(
      "fetch",
      async (
        _input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const body = await new Response(init?.body ?? null).json();
        bodies.push(body as RequestBody);
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "ok" }] } }],
            usageMetadata: { totalTokenCount: 1 },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    );

    await geminiGenerateTextResponse({
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      prompt: "Rewrite this",
      requestOptions: {
        thinkingConfig: { thinkingLevel: "low" },
      },
    });

    expect(bodies[0]).toMatchObject({
      contents: [{ parts: [{ text: "Rewrite this" }] }],
      generationConfig: {
        thinkingConfig: { thinkingLevel: "low" },
      },
    });
  });
});
