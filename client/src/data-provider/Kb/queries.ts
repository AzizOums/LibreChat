/* Knowledge Base (admin) */
import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService, KbIngestionStatus } from 'librechat-data-provider';
import type { UseQueryOptions, QueryObserverResult } from '@tanstack/react-query';
import type {
  TKbDocumentsQuery,
  TKbDocumentsResponse,
  TKbDocumentAccessResponse,
} from 'librechat-data-provider';

const ACTIVE_STATUSES = new Set<string>([KbIngestionStatus.PENDING, KbIngestionStatus.PROCESSING]);

/**
 * Lists KB documents, polling every 3 seconds while any document is still
 * being ingested so the dashboard shows near-real-time progress.
 */
export const useKbDocumentsQuery = (
  params?: TKbDocumentsQuery,
  config?: UseQueryOptions<TKbDocumentsResponse>,
): QueryObserverResult<TKbDocumentsResponse> => {
  return useQuery<TKbDocumentsResponse>(
    [QueryKeys.kbDocuments, params ?? {}],
    () => dataService.listKbDocuments(params),
    {
      refetchOnWindowFocus: false,
      refetchInterval: (data) =>
        data?.documents.some((document) => ACTIVE_STATUSES.has(document.status)) ? 3000 : false,
      ...config,
    },
  );
};

export const useKbDocumentAccessQuery = (
  fileId: string | null,
  config?: UseQueryOptions<TKbDocumentAccessResponse>,
): QueryObserverResult<TKbDocumentAccessResponse> => {
  return useQuery<TKbDocumentAccessResponse>(
    [QueryKeys.kbDocumentAccess, fileId],
    () => dataService.getKbDocumentAccess(fileId as string),
    {
      enabled: fileId != null,
      refetchOnWindowFocus: false,
      ...config,
    },
  );
};
