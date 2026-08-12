import { describe, expect, it } from 'vitest';
import { chunkText } from '../../src/core/knowledge/chunker.js';

describe('chunkText', () => {
  it('returns no chunks for empty content', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('packs short paragraphs into a single chunk', () => {
    const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const chunks = chunkText(content, { maxChars: 1000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(content);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].sequenceOrder).toBe(0);
  });

  it('splits into multiple chunks once the char budget is exceeded', () => {
    const paragraphs = Array.from({ length: 5 }, (_, i) => `Paragraph ${i}. `.repeat(20));
    const content = paragraphs.join('\n\n');
    const chunks = chunkText(content, { maxChars: 200 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(300); // one paragraph can slightly exceed budget alone
    }
    // chunkIndex/sequenceOrder are sequential starting at 0
    chunks.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i);
      expect(chunk.sequenceOrder).toBe(i);
    });
  });

  it('keeps an over-budget single paragraph intact rather than splitting mid-sentence', () => {
    const hugeParagraph = 'word '.repeat(2000).trim(); // no blank-line breaks
    const chunks = chunkText(hugeParagraph, { maxChars: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(hugeParagraph);
  });

  it('produces a stable checksum for identical content and a different one otherwise', () => {
    const [a] = chunkText('Some content here.');
    const [b] = chunkText('Some content here.');
    const [c] = chunkText('Different content here.');
    expect(a.checksum).toBe(b.checksum);
    expect(a.checksum).not.toBe(c.checksum);
  });

  it('estimates tokenCount roughly proportional to content length', () => {
    const [chunk] = chunkText('a'.repeat(400));
    expect(chunk.tokenCount).toBe(100); // 400 chars / 4 chars-per-token
  });
});
