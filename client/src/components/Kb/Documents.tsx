import { useState } from 'react';
import { KbIngestionStatus } from 'librechat-data-provider';
import { Button, Spinner } from '@librechat/client';
import type { TKbDocument } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import {
  useKbDocumentsQuery,
  useRetryKbDocumentMutation,
  useDeleteKbDocumentMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import AccessDialog from './AccessDialog';

const STATUS_LABELS: Record<KbIngestionStatus, TranslationKeys> = {
  [KbIngestionStatus.PENDING]: 'com_ui_kb_status_pending',
  [KbIngestionStatus.PROCESSING]: 'com_ui_kb_status_processing',
  [KbIngestionStatus.COMPLETED]: 'com_ui_kb_status_completed',
  [KbIngestionStatus.ERROR]: 'com_ui_kb_status_error',
};

const STAGE_LABELS: Record<string, TranslationKeys> = {
  uploaded: 'com_ui_kb_stage_uploaded',
  extracting: 'com_ui_kb_stage_extracting',
  chunking: 'com_ui_kb_stage_chunking',
  embedding: 'com_ui_kb_stage_embedding',
  storing: 'com_ui_kb_stage_storing',
  done: 'com_ui_kb_stage_done',
};

const STATUS_CLASSES: Record<KbIngestionStatus, string> = {
  [KbIngestionStatus.PENDING]: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  [KbIngestionStatus.PROCESSING]: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  [KbIngestionStatus.COMPLETED]: 'bg-green-500/15 text-green-600 dark:text-green-400',
  [KbIngestionStatus.ERROR]: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Progress({ document }: { document: TKbDocument }) {
  const localize = useLocalize();
  const { progress, status, chunkCount } = document;

  if (status === KbIngestionStatus.COMPLETED) {
    return (
      <span className="text-sm text-text-secondary">
        {chunkCount ?? 0} {localize('com_ui_kb_chunks')}
      </span>
    );
  }
  if (status === KbIngestionStatus.ERROR) {
    return <span className="text-sm text-red-500">{document.error}</span>;
  }
  if (!progress) {
    return null;
  }

  const stageKey = STAGE_LABELS[progress.stage];
  const { processedChunks, totalChunks } = progress;
  const percent =
    totalChunks != null && totalChunks > 0 && processedChunks != null
      ? Math.round((processedChunks / totalChunks) * 100)
      : null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-text-secondary">
        {stageKey ? localize(stageKey) : progress.stage}
        {percent != null ? ` — ${processedChunks}/${totalChunks} (${percent}%)` : ''}
      </span>
      {percent != null && (
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-tertiary">
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

export default function Documents() {
  const localize = useLocalize();
  const { data, isLoading } = useKbDocumentsQuery();
  const retryMutation = useRetryKbDocumentMutation();
  const deleteMutation = useDeleteKbDocumentMutation();
  const [accessFileId, setAccessFileId] = useState<string | null>(null);

  const documents = data?.documents ?? [];

  return (
    <section className="rounded-xl border border-border-light bg-surface-secondary p-5">
      <h2 className="mb-4 text-lg font-medium text-text-primary">
        {localize('com_ui_kb_documents')}
      </h2>
      {isLoading && <Spinner className="size-5" />}
      {!isLoading && documents.length === 0 && (
        <p className="text-sm text-text-secondary">{localize('com_ui_kb_no_documents')}</p>
      )}
      {documents.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-light text-text-secondary">
                <th className="py-2 pr-4 font-medium">{localize('com_ui_name')}</th>
                <th className="py-2 pr-4 font-medium">{localize('com_ui_size')}</th>
                <th className="py-2 pr-4 font-medium">{localize('com_ui_kb_status')}</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.file_id} className="border-b border-border-light align-top">
                  <td className="max-w-56 truncate py-3 pr-4 text-text-primary">
                    {document.filename}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary">{formatBytes(document.bytes)}</td>
                  <td className="py-3 pr-4">
                    <div className="flex flex-col gap-1">
                      <span
                        className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[document.status]}`}
                      >
                        {localize(STATUS_LABELS[document.status])}
                      </span>
                      <Progress document={document} />
                    </div>
                  </td>
                  <td className="py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAccessFileId(document.file_id)}
                      >
                        {localize('com_ui_kb_manage_access')}
                      </Button>
                      {document.status === KbIngestionStatus.ERROR && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retryMutation.isLoading}
                          onClick={() => retryMutation.mutate(document.file_id)}
                        >
                          {localize('com_ui_kb_retry')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={deleteMutation.isLoading}
                        onClick={() => deleteMutation.mutate(document.file_id)}
                      >
                        {localize('com_ui_delete')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AccessDialog fileId={accessFileId} onClose={() => setAccessFileId(null)} />
    </section>
  );
}
