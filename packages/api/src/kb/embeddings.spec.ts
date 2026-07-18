import axios from 'axios';
import { embedTexts } from './embeddings';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const ollamaConfig = {
  provider: 'ollama',
  model: 'nomic-embed-text',
  baseURL: 'http://localhost:11434',
  dimensions: 3,
};

const openaiConfig = {
  provider: 'openai',
  model: 'text-embedding-3-small',
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  dimensions: 3,
};

beforeEach(() => {
  mockedAxios.post.mockReset();
});

describe('embedTexts', () => {
  it('returns immediately for an empty batch without calling the provider', async () => {
    await expect(embedTexts([], ollamaConfig)).resolves.toEqual([]);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('calls the Ollama native embed route', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        embeddings: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      },
    });
    const result = await embedTexts(['a', 'b'], ollamaConfig);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://localhost:11434/api/embed',
      { model: 'nomic-embed-text', input: ['a', 'b'] },
      expect.anything(),
    );
    expect(result).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('calls the OpenAI-compatible route with authorization and restores input order', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        data: [
          { embedding: [4, 5, 6], index: 1 },
          { embedding: [1, 2, 3], index: 0 },
        ],
      },
    });
    const result = await embedTexts(['a', 'b'], openaiConfig);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      { model: 'text-embedding-3-small', input: ['a', 'b'] },
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-test' } }),
    );
    expect(result).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('rejects a dimension mismatch with an actionable error', async () => {
    mockedAxios.post.mockResolvedValue({ data: { embeddings: [[1, 2, 3, 4]] } });
    await expect(embedTexts(['a'], ollamaConfig)).rejects.toThrow(/KB_EMBEDDINGS_DIM/);
  });

  it('rejects malformed provider responses', async () => {
    mockedAxios.post.mockResolvedValue({ data: { embeddings: [[1, 2, 3]] } });
    await expect(embedTexts(['a', 'b'], ollamaConfig)).rejects.toThrow(/malformed/);
  });
});
