import type { TKbChunkingParams } from 'librechat-data-provider';

const BREAKPOINTS = ['\n\n', '\n', '. ', ' '] as const;

function findBreak(window: string, minPosition: number): number {
  for (const separator of BREAKPOINTS) {
    const index = window.lastIndexOf(separator);
    if (index >= minPosition) {
      return index + separator.length;
    }
  }
  return window.length;
}

/**
 * Splits text into overlapping chunks of at most `chunkSize` characters,
 * preferring paragraph, line, sentence, then word boundaries. Break points are
 * only accepted past the middle of the window so chunks stay reasonably full,
 * and the scan always advances so the split terminates on any input.
 */
export function splitText(text: string, params: TKbChunkingParams): string[] {
  const { chunkSize, chunkOverlap } = params;
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return [];
  }
  if (normalized.length <= chunkSize) {
    return [normalized];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const window = normalized.slice(start, start + chunkSize);
    const isLast = start + chunkSize >= normalized.length;
    const end = isLast ? window.length : findBreak(window, Math.floor(chunkSize / 2));

    const chunk = window.slice(0, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (isLast) {
      break;
    }
    start += Math.max(end - chunkOverlap, 1);
  }
  return chunks;
}
