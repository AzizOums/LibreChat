import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractKbText } from './extract';

let tempDir: string;

beforeAll(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kb-extract-spec-'));
});

afterAll(async () => {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
});

async function writeFile(name: string, content: string): Promise<string> {
  const filepath = path.join(tempDir, name);
  await fs.promises.writeFile(filepath, content);
  return filepath;
}

describe('extractKbText', () => {
  it('reads plain text files directly', async () => {
    const filepath = await writeFile('note.txt', 'Contenu texte brut.');
    const text = await extractKbText({
      filepath,
      filename: 'note.txt',
      mimetype: 'text/plain',
      bytes: 20,
    });
    expect(text).toBe('Contenu texte brut.');
  });

  it('reads markdown files directly, including when the mimetype is generic', async () => {
    const filepath = await writeFile('guide.md', '# Titre\n\nParagraphe.');
    const text = await extractKbText({
      filepath,
      filename: 'guide.md',
      mimetype: 'application/octet-stream',
      bytes: 25,
    });
    expect(text).toBe('# Titre\n\nParagraphe.');
  });

  it('rejects unsupported binary types through the shared parser', async () => {
    const filepath = await writeFile('data.bin', 'binary');
    await expect(
      extractKbText({
        filepath,
        filename: 'data.bin',
        mimetype: 'application/octet-stream',
        bytes: 6,
      }),
    ).rejects.toThrow(/Unsupported file type/);
  });
});
