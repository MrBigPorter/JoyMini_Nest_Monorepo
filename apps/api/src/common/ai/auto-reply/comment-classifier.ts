import { Injectable } from '@nestjs/common';
import { CommentType } from './interfaces/auto-reply.types';

/**
 * Rule-based comment classifier.
 * Categorizes a comment by matching keywords and patterns.
 * Fast, no external dependencies — runs synchronously.
 */
@Injectable()
export class CommentClassifier {
  // Priority order: more specific patterns first, general ones last
  private readonly rules: {
    type: CommentType;
    patterns: RegExp[];
  }[] = [
    {
      // Bug reports: specific error/issue mentions
      type: CommentType.BUG_REPORT,
      patterns: [
        /bug/i,
        /error/i,
        /报错/i,
        /出错了/i,
        /不(能|行|对|工作)/,
        /坏了/i,
        /修(复|改)/i,
        /异常/i,
        /失败/i,
        /崩溃/i,
        /crash/i,
        /broken/i,
        /not working/i,
        /doesn't work/i,
      ],
    },
    {
      // Suggestions: improvement/feature ideas
      type: CommentType.SUGGESTION,
      patterns: [
        /建议/i,
        /可以加/i,
        /能不能(加|增加|添加)/,
        /希望能/i,
        /要是.*就更好了/,
        /建议(你|可以)/i,
        /为什么不/i,
        /should (add|have|support)/i,
        /suggestion/i,
        /feature request/i,
        /it would be (better|nice|great) if/i,
        /consider/i,
        /what about/i,
      ],
    },
    {
      // Questions: explicit questions
      type: CommentType.QUESTION,
      patterns: [
        /\?/,
        /怎么(样|做|实现|配置|用)/,
        /为什么/i,
        /如何/i,
        /能否/i,
        /是否/i,
        /请问/i,
        /什么(是|叫|意思)/,
        /怎么理解/i,
        /how (to|do|can|would)/i,
        /what is/i,
        /can you/i,
        /could you/i,
        /any (idea|thought|suggestion)/i,
        /请教/i,
        /求教/i,
        /不懂/i,
        /不明白/i,
        /求解/i,
        /疑问/i,
      ],
    },
    {
      // Criticism: negative feedback, disagreement
      type: CommentType.CRITICISM,
      patterns: [
        /不好/i,
        /不行/i,
        /不对/i,
        /有问题/i,
        /不认同/i,
        /不同意/i,
        /缺点/i,
        /不足/i,
        /太大/i,
        /太慢/i,
        /复[杂]/i,
        /看不懂/i,
        /disagree/i,
        /not (good|great|correct|right)/i,
        /poor/i,
        /bad/i,
        /terrible/i,
        /misleading/i,
        /incorrect/i,
        /wrong/i,
      ],
    },
    {
      // Praise: compliments, appreciation
      type: CommentType.PRAISE,
      patterns: [
        /好/i,
        /棒/i,
        /赞/i,
        /厉害/i,
        /优秀/i,
        /收藏/i,
        /精彩/i,
        /干货/i,
        /清晰/i,
        /详细/i,
        /有用/i,
        /有帮助/i,
        /受益/i,
        /great/i,
        /nice/i,
        /awesome/i,
        /excellent/i,
        /amazing/i,
        /helpful/i,
        /useful/i,
        /thanks/i,
        /thank/i,
        /good (article|post|job|work)/i,
        /well (done|written|explained)/i,
        /bookmarked/i,
        /saved/i,
        /love (it|this)/i,
      ],
    },
  ];

  classify(content: string): CommentType {
    const trimmed = content.trim();

    // Check rules in priority order, return first match
    for (const rule of this.rules) {
      for (const pattern of rule.patterns) {
        if (pattern.test(trimmed)) {
          return rule.type;
        }
      }
    }

    return CommentType.GENERAL;
  }
}
