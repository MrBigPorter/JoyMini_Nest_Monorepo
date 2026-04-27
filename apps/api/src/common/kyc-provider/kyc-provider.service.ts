import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CompareFacesCommand,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import {
  GenerativeModel,
  HarmBlockThreshold,
  HarmCategory,
  VertexAI,
} from '@google-cloud/vertexai';
// UploadService 仅用于兼容旧方法，核心逻辑不需要它了
import { UploadService } from '@api/common/upload/upload.service';
import {
  KycIdCardType,
  toKycIdCardType,
  normalizeTypeText,
} from '@lucky/shared';
import { randomUUID } from 'node:crypto';

export interface IdCardResult {
  type: KycIdCardType;
  typeText: string;

  country: string;

  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  realName: string | null;

  idNumber: string | null;
  name: string | null;
  gender: string | null;
  birthday: string | null;
  expiryDate?: string | null;

  isSuspicious: boolean;
  fraudScore: number;
  fraudReason: string | null;
  rawText?: string;
}

@Injectable()
export class KycProviderService {
  private readonly logger = new Logger(KycProviderService.name);

  // AWS Rekognition client
  private rekognitionClient: RekognitionClient;
  private readonly livenessPassScore: number;
  private readonly faceMatchScore: number;

  // Vertex AI (Gemini)
  private vertexAI?: VertexAI;
  private geminiModel?: GenerativeModel;

  constructor(
    private configService: ConfigService,
    private uploadService: UploadService,
  ) {
    // --- 1. AWS Rekognition 初始化 ---
    const region = this.configService.get<string>('AWS_REGION', 'us-east-1');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
    );

    this.livenessPassScore = Number(
      this.configService.get<string>('KYC_LIVENESS_PASS_SCORE', '85'),
    );
    this.faceMatchScore = Number(
      this.configService.get<string>('KYC_FACE_MATCH_SCORE', '90'),
    );

    this.rekognitionClient = new RekognitionClient({
      region,
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });

    // --- 2. Vertex AI 初始化 ---
    const googleCredsRaw = this.configService.get<string>(
      'GOOGLE_VISION_CREDENTIALS',
    );
    if (googleCredsRaw) {
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

          this.geminiModel = this.vertexAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
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
              }, // 关键：防止误判证件照
              {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
            ],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 2048,
              responseMimeType: 'application/json',
            },
          });
          this.logger.log(`Vertex AI initialized: ${projectId}`);
        }
      } catch (e) {
        this.logger.error('Failed to parse GOOGLE_VISION_CREDENTIALS', e);
      }
    }
  }

  /**
   * 新版 OCR: 直接接收 Buffer
   * 适用于：前端上传瞬间的实时识别
   */
  async ocrIdCardByBuffer(imageBuffer: Buffer): Promise<IdCardResult> {
    if (!this.geminiModel) {
      throw new InternalServerErrorException('Vertex AI Client not configured');
    }

    try {
      // 直接调 AI，省去下载
      const result = await this.extractWithGemini(imageBuffer);

      if (result) {
        // 只要是 UNKNOWN (0) 或者 AI 明确标记了不支持，就直接在 OCR 阶段拦截
        if (
          result.type === KycIdCardType.UNKNOWN ||
          result.typeText === 'UNKNOWN' ||
          result.fraudReason === 'STUDENT_OR_INVALID_ID_TYPE'
        ) {
          throw new BadRequestException(
            'The document type is not supported. Please use a valid Government ID (Passport, National ID, or Driver’s License).',
          );
        }
        this.logger.log(`Gemini Extraction Success: [${result.type}]`);
        return result;
      } else {
        return {
          type: KycIdCardType.UNKNOWN,
          typeText: 'UNKNOWN',
          country: 'UNKNOWN',

          idNumber: null,
          name: null,

          firstName: null,
          middleName: null,
          lastName: null,
          realName: null,

          birthday: null,
          gender: null,
          expiryDate: null,

          isSuspicious: false,
          fraudScore: 0,
          fraudReason: null,
          rawText: '',
        };
      }
    } catch (error: any) {
      // 1. 先打印真正的错误，别只看 500
      this.logger.error('Gemini OCR Detail Error:', error);

      // 2. 如果是 Gemini 抛出的错误，通常包含 "safety" 或 "blocked"
      if (
        error.message?.includes('SAFETY') ||
        error.message?.includes('blocked')
      ) {
        throw new BadRequestException(
          'Image rejected by AI safety filter. Please use a clear, official ID photo.',
        );
      }

      // 3. 别一棍子打死，保留原始错误的关键信息
      throw new InternalServerErrorException(
        `OCR failed: ${error.message || 'Unknown error'}`,
      );
    }
  }

  /**
   * 旧版兼容 OCR: 通过 Key 下载
   * 适用于：修复旧数据，或后台管理员手动触发重扫
   */
  async ocrIdCardByKey(
    userId: string,
    idCardKey: string,
  ): Promise<IdCardResult> {
    const buffer = await this.uploadService.getFileBuffer(
      idCardKey,
      'kyc',
      userId,
    );
    return this.ocrIdCardByBuffer(buffer);
  }

  /**
   * Gemini 核心提取逻辑 (升级版：加入反欺诈指令 + 代码级误报过滤)
   */
  private async extractWithGemini(
    imageBuffer: Buffer,
  ): Promise<IdCardResult | null> {
    if (!this.geminiModel) return null;

    //  优化后的 Prompt：增加了对字体容错的指令
    const prompt = `
Act as a KYC Security Expert. Analyze this ID card image for OCR and FRAUD detection.
Return ONLY a single valid JSON object (no markdown, no explanation).

RULES:
1. Detect screen recapture, photocopies, or obvious photoshop edits.
2. **IGNORE FONT ARTIFACTS**: Do not misidentify custom security fonts as "Cyrillic".
3. **STRICT ELIGIBILITY**: We ONLY support Government-issued IDs.
4. **REJECT STUDENT/SCHOOL/EMPLOYEE IDS**: If the image is a Student ID, School ID, or non-government ID, you MUST set "type": "UNSUPPORTED", "isSuspicious": true, "fraudScore": 100, and "fraudReason": "STUDENT_OR_INVALID_ID_TYPE".
5. If the card is physically real government ID but OCR is blurry, still try to extract but keep fraudScore low.

Fields:
- type: one of PASSPORT, PH_DRIVER_LICENSE, PH_UMID, PH_NATIONAL_ID, PH_PRC_ID, PH_POSTAL_ID, CN_ID, VN_ID, UNSUPPORTED
- country: PH, CN, VN, GLOBAL, or UNKNOWN
- idNumber: remove spaces/dashes
- name: full name on card
- firstName, middleName, lastName, realName
- birthday: YYYY-MM-DD
- gender: MALE or FEMALE
- expiryDate: YYYY-MM-DD or null

Fraud fields:
- isSuspicious: boolean
- fraudScore: number 0-100
- fraudReason: string or null (e.g., "STUDENT_ID_NOT_ALLOWED" or "SCREEN_RECAPTURE")
`.trim();

    try {
      const result = await this.geminiModel.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: imageBuffer.toString('base64'),
                },
              },
            ],
          },
        ],
      });

      const response = result.response;
      const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;

      const jsonStr = this.extractJsonObject(text);
      if (!jsonStr) {
        this.logger.error(`Gemini returned non-JSON: ${text}`);
        return this.createFallbackResult('AI returned invalid JSON');
      }

      let data: any;
      try {
        data = JSON.parse(jsonStr);
      } catch (e) {
        this.logger.error(`JSON Parse Failed: ${jsonStr}`);
        return this.createFallbackResult('AI JSON parse failed');
      }

      // --- 数据清洗 ---

      // 1. 类型映射
      const typeTextRaw =
        typeof data.type === 'string'
          ? data.type
          : typeof data.typeText === 'string'
            ? data.typeText
            : typeof data.type === 'number'
              ? ((KycIdCardType as any)[data.type] ?? 'UNKNOWN')
              : 'UNKNOWN';

      const typeText = normalizeTypeText(String(typeTextRaw ?? 'UNKNOWN'));
      const type = toKycIdCardType(typeText);

      // 2. 姓名处理
      const fromAi = {
        firstName: this.normNullableString(data.firstName),
        middleName: this.normNullableString(data.middleName),
        lastName: this.normNullableString(data.lastName),
        realName: this.normNullableString(data.realName),
      };
      const fallback = this.splitName(data.name);

      const firstName = fromAi.firstName ?? fallback.firstName;
      const middleName = fromAi.middleName ?? fallback.middleName;
      const lastName = fromAi.lastName ?? fallback.lastName;
      const realName = fromAi.realName ?? fallback.realName;
      const name = this.normNullableString(data.name) ?? realName ?? null;

      // 3. 基础字段
      const country = this.normalizeCountry(data.country);
      const gender = this.normalizeGender(data.gender);
      const idNumber = this.normalizeIdNumber(data.idNumber);
      const birthday = this.normalizeDate(data.birthday);
      const expiryDate = this.normalizeDate(data.expiryDate);

      // 4. 🔥 风控分数逻辑 (含 Cyrillic 补丁)
      let fraudScoreSafe = this.clamp(Number(data.fraudScore));
      let isSuspicious = data.isSuspicious === true || fraudScoreSafe >= 60; // 建议阈值 60
      let fraudReason = this.normNullableString(data.fraudReason);

      // 【补丁】: 强制修正 "Cyrillic" 或 "Font" 相关的误报
      if (fraudReason) {
        const reasonLower = fraudReason.toLowerCase();
        const isFontIssue =
          reasonLower.includes('cyrillic') ||
          reasonLower.includes('font') ||
          reasonLower.includes('mixed script') ||
          reasonLower.includes('alphabet');

        // 如果是因为字体问题扣分，且分数不是极其离谱(>=85)，则强制放行
        if (isFontIssue && fraudScoreSafe < 85) {
          this.logger.warn(
            `Ignoring AI False Positive (Font/Cyrillic): ${fraudReason}`,
          );

          fraudScoreSafe = 20; // 降为低风险
          isSuspicious = false;
          fraudReason = null; // 清空理由，避免前端展示错误警告
        }
      }

      // 如果还是高风险，但 reason 为空，给一个默认值
      if (isSuspicious && !fraudReason) {
        fraudReason = 'Unknown suspicious artifact';
      }

      return {
        type,
        typeText,
        country,
        idNumber,

        firstName,
        middleName,
        lastName,
        realName,

        name,
        birthday,
        gender,
        expiryDate,

        isSuspicious,
        fraudScore: fraudScoreSafe,
        fraudReason,
        rawText: 'Extracted by Gemini AI (2.5-flash) with Fraud Check',
      };
    } catch (e) {
      this.logger.error('Vertex AI Error', e);
      return null;
    }
  }

  async createLivenessSession(
    userId: string,
  ): Promise<{ sessionId: string | undefined }> {
    try {
      const command = new CreateFaceLivenessSessionCommand({
        ClientRequestToken: randomUUID(),
        Settings: { AuditImagesLimit: 1 },
      });
      const response = await this.rekognitionClient.send(command);
      return { sessionId: response.SessionId };
    } catch (error: any) {
      this.logger.error('AWS CreateSession Error', error);
      throw new InternalServerErrorException(
        'could not create liveness session',
      );
    }
  }

  /**
   * 新版活体比对: 直接接收 Buffer
   */
  async verifyLivenessAndMatchIdCard(
    userId: string,
    sessionId: string,
    idCardBuffer: Buffer,
  ): Promise<{
    success: boolean;
    passed: boolean;
    reason: string | null;
    livenessConfidence: number;
    faceSimilarity: number | null;
    referenceImageBytes?: Uint8Array;
  }> {
    try {
      // 1. 获取活体结果
      const livenessCommand = new GetFaceLivenessSessionResultsCommand({
        SessionId: sessionId,
      });
      const livenessResponse =
        await this.rekognitionClient.send(livenessCommand);

      const confidence = livenessResponse.Confidence || 0;
      if (confidence < this.livenessPassScore) {
        return {
          success: true,
          passed: false,
          livenessConfidence: confidence,
          faceSimilarity: null,
          reason: 'Liveness check failed (Low Confidence)',
        };
      }

      const livenessImage = livenessResponse.ReferenceImage?.Bytes;
      if (!livenessImage) {
        return {
          success: false,
          passed: false,
          livenessConfidence: confidence,
          faceSimilarity: null,
          reason: 'Liveness check failed (No Reference Image)',
        };
      }

      // 2. 人证比对 (Source: 活体截图, Target: 用户上传的 Buffer)
      const compareCommand = new CompareFacesCommand({
        SourceImage: { Bytes: livenessImage },
        TargetImage: { Bytes: idCardBuffer },
        SimilarityThreshold: this.faceMatchScore,
      });

      const compareResponse = await this.rekognitionClient.send(compareCommand);
      const faceMatches = compareResponse.FaceMatches || [];
      const similarity = faceMatches[0]?.Similarity ?? 0;

      const isSamePerson =
        faceMatches.length > 0 && similarity >= this.faceMatchScore;

      return {
        success: true,
        passed: isSamePerson,
        livenessConfidence: confidence,
        faceSimilarity: isSamePerson ? similarity : 0,
        reason: isSamePerson
          ? null
          : `Face mismatch (${similarity.toFixed(1)}% < ${this.faceMatchScore}%)`,
        referenceImageBytes: livenessImage,
      };
    } catch (error: any) {
      this.logger.error('AWS Liveness Verification Error', error);
      throw new InternalServerErrorException('Verification failed');
    }
  }

  // --- Helpers ---

  private createFallbackResult(reason: string): IdCardResult {
    return {
      type: KycIdCardType.UNKNOWN,
      typeText: 'UNKNOWN',
      country: 'UNKNOWN',
      idNumber: null,
      name: null,
      firstName: null,
      middleName: null,
      lastName: null,
      realName: null,
      birthday: null,
      gender: 'UNKNOWN',
      expiryDate: null,
      isSuspicious: true,
      fraudScore: 80,
      fraudReason: reason,
      rawText: '',
    };
  }

  private clamp(n: number, min = 0, max = 100) {
    return Math.max(min, Math.min(max, n));
  }

  private normNullableString(v: any): string | null {
    const s =
      typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
    return s ? s : null;
  }

  private normalizeCountry(v: any): string {
    const s = this.normNullableString(v)?.toUpperCase();
    if (!s) return 'UNKNOWN';
    if (s === 'GLOBAL') return 'GLOBAL';
    return s;
  }

  private normalizeGender(v: any): string {
    const s = this.normNullableString(v)?.toUpperCase() ?? '';
    if (!s) return 'UNKNOWN';
    if (s === 'M') return 'MALE';
    if (s === 'F') return 'FEMALE';
    if (s === 'MALE' || s === 'FEMALE') return s;
    return 'UNKNOWN';
  }

  private normalizeIdNumber(v: any): string | null {
    const s = this.normNullableString(v);
    if (!s) return null;
    return s.replace(/[\s-]+/g, '');
  }

  private normalizeDate(v: any): string | null {
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

      const d = new Date(s);
      return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
    }

    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v > 10_000_000_000) return new Date(v).toISOString().slice(0, 10);
      if (v > 100_000_000) return new Date(v * 1000).toISOString().slice(0, 10);
    }
    return null;
  }

  private extractJsonObject(text: string): string | null {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0 || end <= start) return null;
    return cleaned.slice(start, end + 1);
  }

  private splitName(full: any) {
    const raw = String(full ?? '').trim();
    if (!raw) {
      return {
        firstName: null,
        middleName: null,
        lastName: null,
        realName: null,
      };
    }

    if (raw.includes(',')) {
      const [last, rest] = raw.split(',', 2).map((x) => x.trim());
      const parts = rest.split(/\s+/).filter(Boolean);
      const first = parts[0] ?? null;
      const middle = parts.length > 1 ? parts.slice(1).join(' ') : null;
      const realName = [first, middle, last].filter(Boolean).join(' ') || null;
      return {
        firstName: first,
        middleName: middle,
        lastName: last || null,
        realName,
      };
    }

    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return {
        firstName: parts[0],
        middleName: null,
        lastName: null,
        realName: parts[0],
      };
    }
    if (parts.length === 2) {
      const realName = `${parts[0]} ${parts[1]}`;
      return {
        firstName: parts[0],
        middleName: null,
        lastName: parts[1],
        realName,
      };
    }

    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    const middleName = parts.slice(1, -1).join(' ') || null;
    const realName =
      [firstName, middleName, lastName].filter(Boolean).join(' ') || null;
    return { firstName, middleName, lastName, realName };
  }
}
