import { AzureOpenAI } from "openai";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { retry, countWords } from "@voquill/utilities";
import type {
  JsonResponse,
  LlmChatInput,
  LlmStreamEvent,
} from "@voquill/types";
import { openaiCompatibleStreamChat } from "./openai.utils";

export const AZURE_OPENAI_MODELS = [
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4",
  "gpt-35-turbo",
] as const;
export type AzureOpenAIModel = (typeof AZURE_OPENAI_MODELS)[number];

export type AzureOpenAIGenerateTextArgs = {
  apiKey: string;
  endpoint: string;
  deploymentName: string;
  system?: string;
  prompt: string;
  jsonResponse?: JsonResponse;
  requestOptions?: Record<string, unknown>;
};

export type AzureOpenAIGenerateResponseOutput = {
  text: string;
  tokensUsed: number;
};

const createClient = (apiKey: string, endpoint: string) => {
  return new AzureOpenAI({
    apiKey: apiKey.trim(),
    endpoint: endpoint.trim(),
    apiVersion: "2024-10-21",
    dangerouslyAllowBrowser: true,
  });
};

export const azureOpenAIGenerateText = async ({
  apiKey,
  endpoint,
  deploymentName,
  system,
  prompt,
  jsonResponse,
  requestOptions,
}: AzureOpenAIGenerateTextArgs): Promise<AzureOpenAIGenerateResponseOutput> => {
  return retry({
    retries: 3,
    fn: async () => {
      const client = createClient(apiKey, endpoint);

      const messages: ChatCompletionMessageParam[] = [];
      if (system) {
        messages.push({ role: "system", content: system });
      }
      messages.push({ role: "user", content: prompt });

      const requestParams: Record<string, unknown> = {
        temperature: 1,
        max_completion_tokens: 1024,
        ...requestOptions,
        // App-owned: keep these after the user options so they always win.
        stream: false,
        model: deploymentName,
        messages,
      };
      if (jsonResponse) {
        requestParams.response_format = {
          type: "json_schema",
          json_schema: {
            name: jsonResponse.name,
            description: jsonResponse.description,
            schema: jsonResponse.schema,
            strict: true,
          },
        };
      }
      const response = (await client.chat.completions.create(
        requestParams as unknown as Parameters<
          typeof client.chat.completions.create
        >[0],
      )) as ChatCompletion;

      const content = response.choices?.[0]?.message?.content || "";
      return {
        text: content,
        tokensUsed: response.usage?.total_tokens ?? countWords(content),
      };
    },
  });
};

export type AzureOpenAITestIntegrationArgs = {
  apiKey: string;
  endpoint: string;
};

export const azureOpenAITestIntegration = async ({
  apiKey,
  endpoint,
}: AzureOpenAITestIntegrationArgs): Promise<boolean> => {
  const client = createClient(apiKey, endpoint);
  await client.chat.completions.create({
    messages: [{ role: "user", content: "test" }],
    model: "gpt-4o-mini",
    max_completion_tokens: 5,
  });
  return true;
};

// ============================================================================
// Streaming Chat
// ============================================================================

export type AzureOpenAIStreamChatArgs = {
  apiKey: string;
  endpoint: string;
  deploymentName: string;
  input: LlmChatInput;
};

export async function* azureOpenaiStreamChat({
  apiKey,
  endpoint,
  deploymentName,
  input,
}: AzureOpenAIStreamChatArgs): AsyncGenerator<LlmStreamEvent> {
  const client = createClient(apiKey, endpoint);
  yield* openaiCompatibleStreamChat(client, deploymentName, input);
}
