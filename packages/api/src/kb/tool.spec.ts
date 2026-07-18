import { Types } from 'mongoose';
import type { IGroup } from '@librechat/data-schemas';
import { createKbSearchTool } from './tool';
import { searchKbChunks } from './chunks';
import { embedTexts } from './embeddings';

jest.mock('./chunks', () => ({
  searchKbChunks: jest.fn(),
}));

jest.mock('./embeddings', () => ({
  embedTexts: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
}));

const mockedSearch = searchKbChunks as jest.MockedFunction<typeof searchKbChunks>;
const mockedEmbed = embedTexts as jest.MockedFunction<typeof embedTexts>;

const userId = new Types.ObjectId().toHexString();
const groups = [{ _id: new Types.ObjectId(), name: 'RH' }] as IGroup[];

function createTool(overrides: { fileIds?: string[]; fileCitations?: boolean } = {}) {
  const findAccessibleKbFileIds = jest.fn().mockResolvedValue(overrides.fileIds ?? []);
  const getUserGroups = jest.fn().mockResolvedValue(groups);
  const kbTool = createKbSearchTool({
    userId,
    getUserGroups,
    findAccessibleKbFileIds,
    fileCitations: overrides.fileCitations,
  });
  return { kbTool, findAccessibleKbFileIds, getUserGroups };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedEmbed.mockResolvedValue([[0.1, 0.2, 0.3]]);
});

describe('createKbSearchTool', () => {
  it('short-circuits without any vector query when the user has no accessible documents', async () => {
    const { kbTool, findAccessibleKbFileIds } = createTool({ fileIds: [] });
    const [content] = (await kbTool.func({ query: 'congés payés' })) as [string, unknown];

    expect(findAccessibleKbFileIds).toHaveBeenCalledWith({
      userId,
      groupIds: [groups[0]._id],
    });
    expect(mockedEmbed).not.toHaveBeenCalled();
    expect(mockedSearch).not.toHaveBeenCalled();
    expect(content).toContain('No knowledge base documents are accessible');
  });

  it('passes the resolved file allowlist into the vector search', async () => {
    const fileIds = ['file-a', 'file-b'];
    mockedSearch.mockResolvedValue([
      {
        file_id: 'file-a',
        chunk_index: 0,
        content: 'Les congés payés sont de 25 jours.',
        metadata: { source: 'politique-rh.pdf' },
        distance: 0.12,
      },
    ]);
    const { kbTool } = createTool({ fileIds });
    const [content, artifact] = (await kbTool.func({ query: 'congés payés' })) as [
      string,
      Record<string, { sources: Array<{ fileName: string; fileId: string }> }>,
    ];

    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({ fileIds, embedding: [0.1, 0.2, 0.3] }),
    );
    expect(content).toContain('politique-rh.pdf');
    expect(content).toContain('Les congés payés sont de 25 jours.');
    expect(artifact.kb_search.sources[0]).toEqual(
      expect.objectContaining({ fileId: 'file-a', fileName: 'politique-rh.pdf' }),
    );
  });

  it('reports empty results without failing', async () => {
    mockedSearch.mockResolvedValue([]);
    const { kbTool } = createTool({ fileIds: ['file-a'] });
    const [content] = (await kbTool.func({ query: 'sujet inconnu' })) as [string, unknown];
    expect(content).toContain('No relevant content found');
  });

  it('returns a friendly message when the search backend fails', async () => {
    mockedSearch.mockRejectedValue(new Error('pg down'));
    const { kbTool } = createTool({ fileIds: ['file-a'] });
    const [content] = (await kbTool.func({ query: 'test' })) as [string, unknown];
    expect(content).toContain('internal error');
  });

  it('includes citation anchors only when fileCitations is enabled', async () => {
    mockedSearch.mockResolvedValue([
      {
        file_id: 'file-a',
        chunk_index: 0,
        content: 'contenu',
        metadata: { source: 'doc.pdf' },
        distance: 0.2,
      },
    ]);
    const withCitations = createTool({ fileIds: ['file-a'], fileCitations: true });
    const [cited] = (await withCitations.kbTool.func({ query: 'q' })) as [string, unknown];
    expect(cited).toContain('\\ue202turn0file0');

    const withoutCitations = createTool({ fileIds: ['file-a'] });
    const [plain] = (await withoutCitations.kbTool.func({ query: 'q' })) as [string, unknown];
    expect(plain).not.toContain('\\ue202turn0file0');
  });
});
