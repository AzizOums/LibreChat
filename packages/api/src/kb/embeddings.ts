import axios from 'axios';
import type { KbEmbeddingsConfig } from './config';
import { getKbConfig } from './config';

interface OllamaEmbedResponse {
  embeddings: number[][];
}

interface OpenAIEmbedResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

function assertDimensions(embeddings: number[][], config: KbEmbeddingsConfig): void {
  const mismatch = embeddings.find((embedding) => embedding.length !== config.dimensions);
  if (mismatch) {
    throw new Error(
      `Embeddings dimension mismatch: model "${config.model}" returned ${mismatch.length} ` +
        `dimensions but KB_EMBEDDINGS_DIM is ${config.dimensions}. Align KB_EMBEDDINGS_DIM ` +
        `with the model before ingesting.`,
    );
  }
}

async function embedWithOllama(texts: string[], config: KbEmbeddingsConfig): Promise<number[][]> {
  const response = await axios.post<OllamaEmbedResponse>(
    `${config.baseURL.replace(/\/$/, '')}/api/embed`,
    { model: config.model, input: texts },
    { timeout: 120_000 },
  );
  const embeddings = response.data?.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error('Ollama embeddings response is malformed');
  }
  return embeddings;
}

async function embedWithOpenAICompatible(
  texts: string[],
  config: KbEmbeddingsConfig,
): Promise<number[][]> {
  const response = await axios.post<OpenAIEmbedResponse>(
    `${config.baseURL.replace(/\/$/, '')}/embeddings`,
    { model: config.model, input: texts },
    {
      timeout: 120_000,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    },
  );
  const data = response.data?.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error('Embeddings response is malformed');
  }
  const sorted = [...data].sort((a, b) => a.index - b.index);
  return sorted.map((item) => item.embedding);
}

/**
 * Embeds a batch of texts with the configured provider. `ollama` targets the
 * native `/api/embed` route; every other provider value goes through the
 * OpenAI-compatible `/embeddings` contract (OpenAI, Azure via proxy, LiteLLM,
 * vLLM, …), with `KB_EMBEDDINGS_BASE_URL` selecting the server.
 */
export async function embedTexts(
  texts: string[],
  config?: KbEmbeddingsConfig,
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  const embeddingsConfig = config ?? getKbConfig().embeddings;
  const embeddings =
    embeddingsConfig.provider === 'ollama'
      ? await embedWithOllama(texts, embeddingsConfig)
      : await embedWithOpenAICompatible(texts, embeddingsConfig);
  assertDimensions(embeddings, embeddingsConfig);
  return embeddings;
}
