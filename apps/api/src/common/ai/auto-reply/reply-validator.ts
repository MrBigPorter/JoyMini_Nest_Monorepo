import { Injectable } from '@nestjs/common';

/**
 * Validates AI-generated replies to filter out robotic/customer-service style responses.
 * Returns true if the reply passes validation (looks natural).
 */
@Injectable()
export class ReplyValidator {
  // Patterns that indicate a robotic/customer-service reply
  private readonly badPatterns: RegExp[] = [
    /谢谢您的(赞赏|支持|反馈|关注|评论|阅读)/i,
    /感谢您的(赞赏|支持|反馈|关注|评论|阅读)/i,
    /谢谢你的(赞赏|支持|反馈|关注)/i,
    /感谢你的(赞赏|支持|反馈|关注)/i,
    /欢迎随时联系/i,
    /欢迎继续关注/i,
    /感谢您对我们/i,
    /如果您有任何问题/i,
    /请随时与我们联系/i,
    /您的支持是我们/i,
    /我们会继续努力/i,
    /we (appreciate|value) your/i,
    /thank you for your (support|feedback|interest)/i,
    /feel free to contact/i,
    /don't hesitate to/i,
    /please (do not hesitate|feel free)/i,
  ];

  // Minimum reply length (must say something meaningful)
  private readonly MIN_LENGTH = 8;

  // Maximum reply length (don't write a novel)
  private readonly MAX_LENGTH = 600;

  validate(reply: string): boolean {
    const trimmed = reply.trim();

    // Length checks
    if (trimmed.length < this.MIN_LENGTH) return false;
    if (trimmed.length > this.MAX_LENGTH) return false;

    // Check for bad patterns
    for (const pattern of this.badPatterns) {
      if (pattern.test(trimmed)) {
        return false;
      }
    }

    // Check for excessive repetition
    const sentences = trimmed.split(/[.!?。！？\n]/).filter(Boolean);
    const uniqueSentences = new Set(
      sentences.map((s) => s.trim().toLowerCase()),
    );
    if (sentences.length > 1 && uniqueSentences.size === 1) {
      return false; // Same sentence repeated
    }

    return true;
  }
}
