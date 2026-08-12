import { createHash } from 'node:crypto';

export interface TextChunk {
  content: string;
  sequenceOrder: number;
  chunkIndex: number;
  tokenCount: number;
  checksum: string;
}

export interface ChunkOptions {
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 3000;
/** Rough token estimate — no tokenizer dependency, ~4 chars/token for English prose/markdown. */
const CHARS_PER_TOKEN = 4;

function checksumOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Splits markdown/text into paragraph-bounded chunks under `maxChars`. Packs
 * consecutive paragraphs together up to the budget rather than one-chunk-per-
 * paragraph; never splits mid-paragraph — a single paragraph longer than
 * `maxChars` becomes its own oversized chunk rather than being cut mid-sentence.
 */
export function chunkText(content: string, options: ChunkOptions = {}): TextChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: TextChunk[] = [];
  let current = '';

  const flush = () => {
    if (!current) return;
    chunks.push({
      content: current,
      sequenceOrder: chunks.length,
      chunkIndex: chunks.length,
      tokenCount: Math.ceil(current.length / CHARS_PER_TOKEN),
      checksum: checksumOf(current),
    });
    current = '';
  };

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars && current) {
      flush();
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  flush();

  return chunks;
}
