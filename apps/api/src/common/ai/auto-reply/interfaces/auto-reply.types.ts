export enum CommentType {
  PRAISE = 'praise',
  QUESTION = 'question',
  SUGGESTION = 'suggestion',
  BUG_REPORT = 'bug_report',
  CRITICISM = 'criticism',
  GENERAL = 'general',
}

export interface CommentContext {
  /** The raw comment text */
  content: string;
  /** Comment author name (masked) */
  author?: string;
  /** Article title */
  articleTitle: string;
  /** Article content preview (first N chars) */
  articlePreview?: string;
  /** Article tags */
  articleTags?: string[];
  /** Article category */
  articleCategory?: string;
  /** Estimated reading time in minutes */
  readingTime?: number;
  /** Is this a new commenter or returning */
  isReturningCommenter?: boolean;
  /** Language of the comment (auto-detected) */
  language?: string;
}

export interface ReplyResult {
  /** The generated reply text */
  content: string;
  /** The comment type that was detected */
  commentType: CommentType;
  /** How many attempts were needed (1 = first try, 2+ = retried) */
  attempts: number;
  /** Whether validation passed */
  validated: boolean;
}

export interface PromptTemplate {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}
