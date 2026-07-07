import { Injectable, Logger } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

// ========== Types ==========

export interface ChunkOptions {
  /** Max characters per chunk (default: 500) */
  chunkSize?: number;
  /** Overlap between adjacent chunks in characters (default: 50) */
  chunkOverlap?: number;
  /** Safety limit — max chunks returned (default: 300) */
  maxChunks?: number;
}

export interface ChunkResult {
  /** 0-based index within the document */
  index: number;
  /** Chunk content (plain text, no markdown artifacts) */
  content: string;
  /** Estimated token count (~4 chars per token) */
  tokenCount: number;
}

// ========== Service ==========

/**
 * RagChunkService — Pure text chunking using RecursiveCharacterTextSplitter.
 *
 * Design:
 * - Uses LangChain's battle-tested RecursiveCharacterTextSplitter
 * - Separator priority: `## ` → `### ` → `\n\n` → `\n` → `。；` → ` ` → ``
 *   (markdown heading → paragraph → line → CJK sentence → word → character)
 * - Pure function: no DB / vector dependencies — just text in, chunks out
 * - The caller (rag-sync.service.ts uploadFile) is responsible for
 *   persisting chunks and triggering embedding
 *
 * @example
 * const chunks = ragChunkService.chunkText(longMarkdown);
 * // → [{ index: 0, content: '...', tokenCount: 125 }, ...]
 */
@Injectable()
export class RagChunkService {
  private readonly logger = new Logger(RagChunkService.name);

  private readonly DEFAULT_CHUNK_SIZE = 500;
  private readonly DEFAULT_CHUNK_OVERLAP = 50;
  private readonly MAX_CHUNKS = 300;

  /**
   * Split `text` into chunks.
   *
   * @param text  — Raw markdown or plain text
   * @param options  — Optional override for chunkSize / chunkOverlap / maxChunks
   * @returns  Ordered array of ChunkResult
   */
  async chunkText(
    text: string,
    options?: ChunkOptions,
  ): Promise<ChunkResult[]> {
    const chunkSize = options?.chunkSize ?? this.DEFAULT_CHUNK_SIZE;
    const chunkOverlap = options?.chunkOverlap ?? this.DEFAULT_CHUNK_OVERLAP;
    const maxChunks = options?.maxChunks ?? this.MAX_CHUNKS;

    if (!text || text.trim().length === 0) {
      this.logger.warn('chunkText called with empty text');
      return [];
    }

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      separators: ['## ', '### ', '\n\n', '\n', '。；', ' ', ''],
      // keepSeparator: false  — do not keep separators in chunk content
    });

    const rawChunks = await splitter.splitText(text);

    // Enforce safety limit
    const capped = rawChunks.slice(0, maxChunks);

    if (rawChunks.length > maxChunks) {
      this.logger.warn(
        `Document produced ${rawChunks.length} chunks, capped at ${maxChunks}`,
      );
    }

    this.logger.debug(
      `chunkText: ${text.length} chars → ${capped.length} chunks ` +
        `(size=${chunkSize}, overlap=${chunkOverlap})`,
    );

    return capped.map((content, index) => ({
      index,
      content,
      tokenCount: this.estimateTokens(content),
    }));
  }

  // ==================== Private helpers ====================

  /**
   * Rough token estimation.
   * - CJK / mixed: ~1 token per 2 characters (conservative)
   * - Pure ASCII: ~1 token per 4 characters
   * - We use a blended heuristic: count non-ASCII chars double
   */
  private estimateTokens(text: string): number {
    let asciiCount = 0;
    let nonAsciiCount = 0;

    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) < 128) {
        asciiCount++;
      } else {
        nonAsciiCount++;
      }
    }

    return Math.ceil(asciiCount / 4 + nonAsciiCount / 2);
  }
}
