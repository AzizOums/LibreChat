import { splitText } from './splitter';

const params = { chunkSize: 100, chunkOverlap: 20 };

describe('splitText', () => {
  it('returns an empty array for empty or whitespace-only text', () => {
    expect(splitText('', params)).toEqual([]);
    expect(splitText('   \n\n  ', params)).toEqual([]);
  });

  it('returns a single chunk when the text fits', () => {
    expect(splitText('Bonjour le monde.', params)).toEqual(['Bonjour le monde.']);
  });

  it('never produces chunks larger than chunkSize', () => {
    const text = Array.from({ length: 50 }, (_, i) => `Phrase numéro ${i} du document.`).join(' ');
    const chunks = splitText(text, params);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(params.chunkSize);
    }
  });

  it('covers the full text without losing content', () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Contenu unique ${i}.`);
    const chunks = splitText(sentences.join(' '), params);
    const joined = chunks.join(' ');
    for (const sentence of sentences) {
      expect(joined).toContain(sentence);
    }
  });

  it('prefers paragraph boundaries', () => {
    const paragraphOne = 'Premier paragraphe assez long pour remplir la moitié de la fenêtre.';
    const paragraphTwo = 'Second paragraphe qui devrait commencer un nouveau chunk proprement.';
    const chunks = splitText(`${paragraphOne}\n\n${paragraphTwo}`, params);
    expect(chunks[0]).toBe(paragraphOne);
    expect(chunks[chunks.length - 1].endsWith(paragraphTwo)).toBe(true);
  });

  it('overlaps consecutive chunks', () => {
    const text = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ');
    const chunks = splitText(text, { chunkSize: 100, chunkOverlap: 30 });
    expect(chunks.length).toBeGreaterThan(1);
    const tail = chunks[0].slice(-10);
    expect(chunks[1]).toContain(tail.trim().split(' ').pop() as string);
  });

  it('terminates on pathological input without separators', () => {
    const text = 'a'.repeat(5000);
    const chunks = splitText(text, { chunkSize: 500, chunkOverlap: 100 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
    expect(chunks.join('').length).toBeGreaterThanOrEqual(5000);
  });

  it('normalizes Windows line endings and excessive blank lines', () => {
    const chunks = splitText('ligne un\r\n\r\n\r\n\r\nligne deux', {
      chunkSize: 100,
      chunkOverlap: 0,
    });
    expect(chunks).toEqual(['ligne un\n\nligne deux']);
  });
});
