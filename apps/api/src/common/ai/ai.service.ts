import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GenerativeModel,
  HarmBlockThreshold,
  HarmCategory,
  VertexAI,
  GenerateContentResult,
} from '@google-cloud/vertexai';

export interface AiModerationResult {
  score: number; // 0-100, 越高越危险
  passed: boolean;
  reason: string | null;
  categories: string[];
  autoReplySuggestion?: string;
}

export interface AiGenerationOptions {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  systemPrompt?: string;
}

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);

  private vertexAI?: VertexAI;
  private geminiModel?: GenerativeModel;
  private isEnabled = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeVertexAI();
  }

  private async initializeVertexAI() {
    const googleCredsRaw = this.configService.get<string>(
      'GOOGLE_VISION_CREDENTIALS',
    );

    if (!googleCredsRaw) {
      this.logger.warn(
        'Google Vertex AI credentials not configured, AI service disabled',
      );
      return;
    }

    try {
      const credentials = JSON.parse(googleCredsRaw);
      const projectId =
        credentials.project_id || this.configService.get('GOOGLE_PROJECT_ID');

      if (projectId) {
        this.vertexAI = new VertexAI({
          project: projectId,
          location: 'us-central1',
          googleAuthOptions: { credentials },
        });

        //  使用 Gemini 2.0 Flash 永久免费版
        this.geminiModel = this.vertexAI.getGenerativeModel({
          model: 'gemini-2.0-flash',
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 2048,
          },
        });

        this.isEnabled = true;
        this.logger.log(
          ` Vertex AI initialized with Gemini 2.0 Flash (FREE TIER)`,
        );
      }
    } catch (e) {
      this.logger.error('Failed to initialize Vertex AI', e);
    }
  }

  /**
   * 通用文本生成接口
   * 所有AI功能的统一入口
   */
  async generateText(
    prompt: string,
    options?: AiGenerationOptions,
  ): Promise<string | null> {
    if (!this.isEnabled || !this.geminiModel) {
      return null;
    }

    try {
      const result = await this.geminiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: options,
      });

      const response = await result.response;
      return response.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (e) {
      this.logger.error('AI generation error', e);
      return null;
    }
  }

  /**
   * 评论内容智能审核
   */
  async moderateComment(
    content: string,
    articleTitle?: string,
  ): Promise<AiModerationResult> {
    const prompt = `
Act as a professional content moderator. Analyze this comment and return ONLY a JSON object.

Comment content: "${content}"
${articleTitle ? `Article context: "${articleTitle}"` : ''}

RULES:
1. Score from 0-100. 0=completely safe, 100=extremely dangerous
2. Categories: SPAM, ADVERTISEMENT, HATE, HARASSMENT, VIOLENCE, SEXUAL, POLITICAL, FRAUD, OTHER
3. passed = score < 50
4. If score < 30 also provide a friendly relevant auto reply suggestion (1-2 sentences)

Return JSON format:
{
  "score": number,
  "passed": boolean,
  "reason": string | null,
  "categories": string[],
  "autoReplySuggestion": string | null
}
`.trim();

    const response = await this.generateText(prompt, {
      temperature: 0,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    });

    if (!response) {
      return { score: 0, passed: true, reason: null, categories: [] };
    }

    try {
      const jsonStr = this.extractJsonObject(response);
      return JSON.parse(jsonStr);
    } catch (e) {
      this.logger.warn('Failed to parse moderation result', response);
      return { score: 0, passed: true, reason: null, categories: [] };
    }
  }

  /**
   * 生成自动回复
   */
  async generateAutoReply(
    comment: string,
    articleTitle: string,
    articleContent?: string,
  ): Promise<string | null> {
    const prompt = `
Act as a friendly blog community manager. Generate a natural, relevant reply to this comment.

Article title: "${articleTitle}"
${articleContent ? `Article content preview: "${articleContent.slice(0, 500)}"` : ''}
User comment: "${comment}"

RULES:
1. Keep reply 1-2 sentences long
2. Be natural and human-like, not robotic
3. Be friendly and encouraging
4. Reference the article or comment content
5. Do NOT mention that you are an AI
6. Respond in the same language as the comment
`.trim();

    return this.generateText(prompt, {
      temperature: 0.7,
      maxOutputTokens: 256,
    });
  }

  /**
   * ⏳ 预留：生成向量嵌入 (用于未来智能搜索)
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    // TODO: 实现向量嵌入接口，用于语义搜索
    this.logger.debug('Embedding generation requested, feature coming soon');
    return null;
  }

  /**
   * ⏳ 预留：语义搜索匹配
   */
  async semanticSearch(query: string, documents: string[]): Promise<number[]> {
    // TODO: 实现语义搜索排序
    return [];
  }

  isAvailable(): boolean {
    return this.isEnabled;
  }

  private extractJsonObject(text: string): string {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    return start >= 0 && end > start ? cleaned.slice(start, end + 1) : '{}';
  }
}
