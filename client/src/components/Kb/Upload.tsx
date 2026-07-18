import { useRef, useState } from 'react';
import { Button, Input, Label, Spinner } from '@librechat/client';
import { useUploadKbDocumentMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const ACCEPTED_TYPES = '.pdf,.docx,.txt,.md,.markdown';

export default function Upload() {
  const localize = useLocalize();
  const inputRef = useRef<HTMLInputElement>(null);
  const [chunkSize, setChunkSize] = useState('');
  const [chunkOverlap, setChunkOverlap] = useState('');
  const [error, setError] = useState<string | null>(null);
  const uploadMutation = useUploadKbDocumentMutation();

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return;
    }
    setError(null);
    for (const file of Array.from(fileList)) {
      const formData = new FormData();
      formData.append('file', file, file.name);
      if (chunkSize) {
        formData.append('chunkSize', chunkSize);
      }
      if (chunkOverlap) {
        formData.append('chunkOverlap', chunkOverlap);
      }
      try {
        await uploadMutation.mutateAsync(formData);
      } catch (uploadError) {
        setError(`${file.name}: ${(uploadError as Error).message}`);
      }
    }
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <section className="rounded-xl border border-border-light bg-surface-secondary p-5">
      <h2 className="mb-1 text-lg font-medium text-text-primary">{localize('com_ui_kb_upload')}</h2>
      <p className="mb-4 text-sm text-text-secondary">{localize('com_ui_kb_upload_hint')}</p>
      <div className="mb-4 flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="kb-chunk-size" className="text-sm text-text-secondary">
            {localize('com_ui_kb_chunk_size')}
          </Label>
          <Input
            id="kb-chunk-size"
            type="number"
            className="w-32"
            placeholder="1000"
            value={chunkSize}
            onChange={(event) => setChunkSize(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="kb-chunk-overlap" className="text-sm text-text-secondary">
            {localize('com_ui_kb_chunk_overlap')}
          </Label>
          <Input
            id="kb-chunk-overlap"
            type="number"
            className="w-32"
            placeholder="200"
            value={chunkOverlap}
            onChange={(event) => setChunkOverlap(event.target.value)}
          />
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple={true}
        accept={ACCEPTED_TYPES}
        className="hidden"
        aria-label={localize('com_ui_kb_upload')}
        onChange={(event) => handleFiles(event.target.files)}
      />
      <div className="flex items-center gap-3">
        <Button
          variant="default"
          disabled={uploadMutation.isLoading}
          onClick={() => inputRef.current?.click()}
        >
          {uploadMutation.isLoading ? <Spinner className="mr-2 size-4" /> : null}
          {localize('com_ui_upload')}
        </Button>
        {error != null && <span className="text-sm text-red-500">{error}</span>}
      </div>
    </section>
  );
}
