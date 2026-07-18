import { z } from 'zod';
import { logger } from '@librechat/data-schemas';
import { Tools } from 'librechat-data-provider';
import { tool } from '@librechat/agents/langchain/tools';
import type { IGroup, KbDocumentMethods } from '@librechat/data-schemas';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import { searchKbChunks } from './chunks';
import { embedTexts } from './embeddings';

export interface KbSearchDeps {
  userId: string;
  getUserGroups: (userId: string) => Promise<IGroup[]>;
  findAccessibleKbFileIds: KbDocumentMethods['findAccessibleKbFileIds'];
  k?: number;
  fileCitations?: boolean;
}

export const kbSearchSchema: z.ZodObject<{ query: z.ZodString }> = z.object({
  query: z
    .string()
    .describe(
      'A natural language query to semantically search the organization knowledge base. Be specific and use keywords related to the information you are looking for.',
    ),
});

const DEFAULT_K = 8;

interface KbSearchSource {
  type: 'file';
  fileId: string;
  content: string;
  fileName: string;
  relevance: number;
  pages: number[];
  pageRelevance: Record<number, number>;
}

/**
 * Access-scoped semantic search over the admin-managed knowledge base.
 *
 * Access rights are resolved at call time (user overrides beat group grants)
 * and the resulting `file_id` allowlist is applied inside the pgvector WHERE
 * clause — a user without rights triggers no vector query at all, and chunks
 * from documents outside the allowlist can never be returned.
 */
export function createKbSearchTool(
  deps: KbSearchDeps,
): DynamicStructuredTool<typeof kbSearchSchema> {
  const { userId, getUserGroups, findAccessibleKbFileIds, k = DEFAULT_K, fileCitations } = deps;

  return tool(
    async ({ query }: z.infer<typeof kbSearchSchema>) => {
      try {
        const groups = await getUserGroups(userId);
        const groupIds = groups.map((group) => group._id);
        const fileIds = await findAccessibleKbFileIds({ userId, groupIds });

        if (fileIds.length === 0) {
          return [
            'No knowledge base documents are accessible to this user. Do not retry; answer from general knowledge and mention that no internal documents are available.',
            undefined,
          ];
        }

        const [embedding] = await embedTexts([query]);
        const rows = await searchKbChunks({ embedding, fileIds, k });

        if (rows.length === 0) {
          return [
            'No relevant content found in the accessible knowledge base documents for this query.',
            undefined,
          ];
        }

        const formattedString = rows
          .map((row, index) => {
            const fileName = row.metadata?.source ?? row.file_id;
            const anchor = fileCitations ? `\nAnchor: \\ue202turn0file${index} (${fileName})` : '';
            return `File: ${fileName}${anchor}\nRelevance: ${(1.0 - row.distance).toFixed(4)}\nContent: ${row.content}\n`;
          })
          .join('\n---\n');

        const sources: KbSearchSource[] = rows.map((row) => ({
          type: 'file',
          fileId: row.file_id,
          content: row.content,
          fileName: row.metadata?.source ?? row.file_id,
          relevance: 1.0 - row.distance,
          pages: row.metadata?.page != null ? [row.metadata.page] : [],
          pageRelevance:
            row.metadata?.page != null ? { [row.metadata.page]: 1.0 - row.distance } : {},
        }));

        return [formattedString, { [Tools.kb_search]: { sources, fileCitations } }];
      } catch (error) {
        logger.error('[kb_search] Search failed:', error);
        return ['The knowledge base search failed due to an internal error.', undefined];
      }
    },
    {
      name: Tools.kb_search,
      responseFormat: 'content_and_artifact',
      description: `Performs semantic search across the organization's internal knowledge base using natural language queries. Only documents the current user is allowed to read are searched. Use this tool to answer questions about internal policies, procedures, and organizational documents.${
        fileCitations
          ? `

**CITE KNOWLEDGE BASE RESULTS:**
Use the EXACT anchor markers shown in the results (copy them verbatim) immediately after statements derived from document content, and mention the file name in your text before the marker.`
          : ''
      }`,
      schema: kbSearchSchema,
    },
  );
}
