import fs from 'fs';
import { parseDocument } from '~/files/documents/crud';

export interface ExtractKbTextParams {
  filepath: string;
  filename: string;
  mimetype: string;
  bytes: number;
}

const PLAIN_TEXT_TYPES: ReadonlySet<string> = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
]);

const PLAIN_TEXT_EXTENSIONS = /\.(txt|md|markdown)$/i;

/**
 * Extracts the raw text of a KB source file. Plain text and Markdown are read
 * directly; PDF and DOCX go through the shared `parseDocument` pipeline
 * (pdfjs-dist / mammoth with zip-bomb protection), which enforces its own
 * 15MB parser cap for those formats.
 */
export async function extractKbText(params: ExtractKbTextParams): Promise<string> {
  const { filepath, filename, mimetype, bytes } = params;

  if (PLAIN_TEXT_TYPES.has(mimetype) || PLAIN_TEXT_EXTENSIONS.test(filename)) {
    return await fs.promises.readFile(filepath, 'utf8');
  }

  const result = await parseDocument({
    file: {
      path: filepath,
      originalname: filename,
      mimetype,
      size: bytes,
    } as Express.Multer.File,
  });
  return result.text;
}
