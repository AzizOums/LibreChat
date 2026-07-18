import fs from 'fs';
import path from 'path';
import { logger } from '@librechat/data-schemas';

export interface SaveKbSourceParams {
  tempPath: string;
  uploadsDir: string;
  fileId: string;
  filename: string;
}

const EXTENSION_PATTERN = /^\.[a-zA-Z0-9]{1,10}$/;

function safeExtension(filename: string): string {
  const extension = path.extname(filename);
  return EXTENSION_PATTERN.test(extension) ? extension.toLowerCase() : '';
}

/**
 * Moves an uploaded temp file into the KB uploads directory as
 * `<fileId><ext>`. The name is derived from the server-generated UUID, never
 * from user input, so the destination cannot escape `uploadsDir`.
 */
export async function saveKbSource(params: SaveKbSourceParams): Promise<string> {
  const { tempPath, uploadsDir, fileId, filename } = params;
  await fs.promises.mkdir(uploadsDir, { recursive: true });
  const destination = path.join(uploadsDir, `${fileId}${safeExtension(filename)}`);

  try {
    await fs.promises.rename(tempPath, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV') {
      throw error;
    }
    await fs.promises.copyFile(tempPath, destination);
    await fs.promises.unlink(tempPath);
  }
  return destination;
}

/**
 * Best-effort removal of a KB source file. Refuses paths outside
 * `uploadsDir` so a corrupted document record can never delete arbitrary
 * files.
 */
export async function deleteKbSource(filepath: string, uploadsDir: string): Promise<boolean> {
  const resolved = path.resolve(filepath);
  const root = path.resolve(uploadsDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    logger.warn(`[kb] Refusing to delete source file outside uploads dir: ${filepath}`);
    return false;
  }

  try {
    await fs.promises.unlink(resolved);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return true;
    }
    logger.warn(`[kb] Failed to delete source file ${filepath}:`, error);
    return false;
  }
}
