# KYC 双云供应商：AWS Rekognition + Google AI Studio Gemini 身份核验

> **源码参考**: [`kyc-provider.service.ts`](apps/api/src/common/kyc-provider/kyc-provider.service.ts) (542 行)

> **⚠️ 迁移通知 (2026-05-02):** OCR 引擎已从 **Vertex AI (付费)** 迁移至 **Google AI Studio (免费)**。详见[迁移文档](ai-service-migration-vertex-ai-to-ai-studio.md)。

---

## 概述

KYC (Know Your Customer) 是本平台金融级风控的核心环节。用户需要完成 **身份证 OCR 识别 + 活体检测 + 人脸比对** 三步才能通过认证。本服务采用双云供应商架构：

| 云厂商 | 服务 | 用途 |
|--------|------|------|
| **AWS** | Rekognition | 活体检测 (`CreateFaceLivenessSession`) + 人脸比对 (`CompareFaces`) |
| **Google** | AI Studio Gemini 2.5 Flash | 身份证 OCR 提取 + 欺诈检测 |

这种架构的优势在于：
- **AWS Rekognition** 在面部识别领域经过 NIST 认证，活体检测精度高
- **Gemini 2.5 Flash** 的多模态理解能力强，能处理扭曲/反光/模糊的身份证照片
- 双云解耦，任一服务故障不影响另一链路

---

## 架构总览

```
┌──────────────┐     ┌──────────────────────────────────────┐
│  用户上传     │     │          KycProviderService            │
│  身份证照片   │────▶│                                        │
│  + 自拍视频   │     │  ┌──────────────────────────────────┐  │
└──────────────┘     │  │  ocrIdCardByBuffer()              │  │
                     │  │  ├─ Gemini OCR 提取               │  │
                     │  │  └─ 返回 IdCardResult               │  │
                     │  │                                      │
                     │  │  verifyLivenessAndMatchIdCard()      │  │
                     │  │  ├─ AWS CreateFaceLivenessSession    │  │
                     │  │  ├─ AWS GetFaceLivenessSessionResults│  │
                     │  │  ├─ AWS CompareFaces                 │  │
                     │  │  └─ 返回 LivenessMatchResult         │  │
                     │  └──────────────────────────────────┘  │
                     └──────────────────────────────────────┘
```

---

## 1. 身份证 OCR — `ocrIdCardByBuffer()`

### 1.1 双路径设计

```typescript
// 直接 Buffer OCR（首选）
async ocrIdCardByBuffer(imageBuffer: Buffer): Promise<IdCardResult> {
  return this.extractWithGemini(imageBuffer, 'buffer');
}

// 通过 Key 下载后 OCR（遗留兼容）
async ocrIdCardByKey(key: string): Promise<IdCardResult> {
  const buffer = await this.uploadService.getFileBuffer(key, 'kyc');
  return this.extractWithGemini(buffer, 's3_key');
}
```

核心逻辑在 [`extractWithGemini()`](apps/api/src/common/kyc-provider/kyc-provider.service.ts:231) 中，使用 Gemini 2.5 Flash 的多模态能力。

### 1.2 Gemini Prompt 设计

15 行的完整 Prompt 涵盖了：

```typescript
private async extractWithGemini(
  imageBuffer: Buffer,
  source: string,
): Promise<IdCardResult> {
  // ...
  const prompt = `You are an expert KYC identity document analyzer.
Extract information from this ID card image and return JSON.

Rules:
1. All text fields extract exactly as printed (preserve case, punctuation)
2. Dates normalize to YYYY-MM-DD format
3. Gender field: return MALE, FEMALE, or null
4. Return NULL for any field not clearly readable
5. Set fraudScore (0-100) based on:
   - Text inconsistencies (>80)
   - Forged appearance (>80)
   - Watermark/logo issues (>70)
   - Edge/corner damage (>30)
   - Normal document (<20)

Response format (JSON only):
{
  "fullName": string | null,
  "dateOfBirth": string | null,
  "gender": string | null,
  "idNumber": string | null,
  "address": string | null,
  "nationality": string | null,
  "country": string | null,
  "documentType": string | null,
  "dateOfIssue": string | null,
  "dateOfExpiry": string | null,
  "fraudScore": number,
  "fraudReasons": string[]
}`;
```

**关键设计点**：

- `responseMimeType: 'application/json'` — 强制 Gemini 返回合法 JSON，避免 markdown 代码块包裹
- `temperature: 0` — 零随机性，确保同一张图片每次提取结果一致
- **Safety Settings** 全部设为 `BLOCK_NONE`，因为身份证文档可能包含风险文本（如 "government"、"ID" 等），不能误拦截

### 1.3 Cyrillic 字体假阳性补丁

生产环境中发现一个特殊问题：**某些身份证使用 Cyrillic 字体（西里尔字母）**，Gemini 会误判为伪造文本，返回极高的 `fraudScore`。解决方案：

```typescript
// Cyrillic font false positive patch
if (result.fraudScore < 85) {
  result.fraudScore = Math.min(result.fraudScore, 20);
}
```

**阈值逻辑**：
- `fraudScore >= 85` → 保留原始分数（可能真有问题）
- `fraudScore < 85` → 强制降级到 20（避免 Cyrillic 字体假阳性）

### 1.4 `IdCardResult` 接口

```typescript
export interface IdCardResult {
  fullName: string | null;
  dateOfBirth: string | null;    // YYYY-MM-DD
  gender: string | null;         // MALE / FEMALE
  idNumber: string | null;
  address: string | null;
  nationality: string | null;
  country: string | null;
  documentType: string | null;
  dateOfIssue: string | null;    // YYYY-MM-DD
  dateOfExpiry: string | null;   // YYYY-MM-DD
  fraudScore: number;            // 0-100
  fraudReasons: string[];
}
```

---

## 2. 活体检测 + 人脸比对 — `verifyLivenessAndMatchIdCard()`

这是一个三步流水线：

```
Step 1: CreateFaceLivenessSession  ──▶ 返回 SessionId
Step 2: GetFaceLivenessSessionResults ──▶ 验证活体
Step 3: CompareFaces ──▶ 比对身份证照片与自拍
```

### 2.1 创建活体检测会话

```typescript
async createLivenessSession(): Promise<{ sessionId: string }> {
  const command = new CreateFaceLivenessSessionCommand({
    Settings: {
      OutputConfig: {
        S3Bucket: this.config.get('AWS_S3_KYC_BUCKET'),
        S3Prefix: `liveness/${uuidv4()}/`,
      },
    },
  });
  const response = await this.rekognitionClient.send(command);
  return { sessionId: response.SessionId! };
}
```

### 2.2 验证活体结果 + 人脸比对

```typescript
async verifyLivenessAndMatchIdCard(
  sessionId: string,
  idCardBuffer: Buffer,
): Promise<LivenessMatchResult> {
  // Step 1: 获取活体检测结果
  const resultCommand = new GetFaceLivenessSessionResultsCommand({
    SessionId: sessionId,
  });
  const result = await this.rekognitionClient.send(resultCommand);

  if (result.Status !== 'SUCCEEDED') {
    return { passed: false, confidence: 0, reason: 'Liveness check failed' };
  }

  // Step 2: 从 S3 获取活体验证参考图片
  const referenceImage = await this.getLivenessReferenceImage(result);
  const livePhoto = await this.bufferToImage(referenceImage);

  // Step 3: 人脸比对
  const compareCommand = new CompareFacesCommand({
    SourceImage: { Bytes: idCardBuffer },
    TargetImage: { Bytes: referenceImage },
    SimilarityThreshold: 80,  // 80% 相似度阈值
  });
  const compareResult = await this.rekognitionClient.send(compareCommand);

  if (compareResult.FaceMatches?.length) {
    const match = compareResult.FaceMatches[0];
    return {
      passed: match.Similarity >= 80,
      confidence: match.Similarity,
      reason: match.Similarity >= 80 ? 'Faces match' : 'Low similarity',
    };
  }

  return { passed: false, confidence: 0, reason: 'No matching faces found' };
}
```

**关键参数**：
- `SimilarityThreshold: 80` — AWS 官方建议的最低阈值，低于此值直接不返回匹配结果
- `SourceImage` — 身份证照片
- `TargetImage` — 活体自拍参考帧

---

## 3. 辅助工具方法

### 3.1 `splitName()` — 姓名分割

```typescript
private splitName(full: any) {
  if (!full || typeof full !== 'string') {
    return { firstName: null, lastName: null };
  }
  const parts = full.split(',').map((s: string) => s.trim());
  if (parts.length >= 2) {
    return { firstName: parts[1], lastName: parts[0] };
  }
  const spaces = full.split(' ').filter(Boolean);
  if (spaces.length >= 2) {
    return { firstName: spaces.slice(0, -1).join(' '), lastName: spaces[spaces.length - 1] };
  }
  return { firstName: full, lastName: null };
}
```

处理两种格式：
- **逗号分隔**: `"Dela Cruz, Juan"` → firstName=`"Juan"`, lastName=`"Dela Cruz"`
- **空格分隔**: `"Juan Dela Cruz"` → firstName=`"Juan Dela"`, lastName=`"Cruz"`

### 3.2 `normalizeDate()` — 日期标准化

```typescript
private normalizeDate(v: any): string | null {
  if (!v) return null;
  const dateStr = String(v).trim();
  // 尝试多种格式
  const patterns = [
    /^(\d{4})-(\d{2})-(\d{2})$/,          // 2024-01-15
    /^(\d{2})[\/-](\d{2})[\/-](\d{4})$/,   // 01/15/2024 or 15-01-2024
    /^(\d{4})[\/](\d{2})[\/](\d{2})$/,     // 2024/01/15
  ];
  // ... 多格式尝试 + 有效性验证
}
```

通过 **3 种正则模式** 匹配常见日期格式，最终统一输出 `YYYY-MM-DD`。

### 3.3 `normalizeGender()` — 性别标准化

```typescript
private normalizeGender(v: any): string {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (['M', 'MALE', 'L', 'LAKILAKI'].includes(s)) return 'MALE';
  if (['F', 'FEMALE', 'P', 'BABAE'].includes(s)) return 'FEMALE';
  return null;
}
```

支持多语言（英语/菲律宾语）的性别值映射。

---

## 4. 错误处理策略

| 场景 | 处理方式 |
|------|----------|
| Gemini OCR 返回 JSON 解析失败 | `extractJsonObject()` 尝试从 markdown 代码块提取 |
| AWS Rekognition Session 过期 | 客户端需要重新创建 Session |
| 活体检测未通过 | 返回 `{ passed: false, confidence: 0 }` |
| 人脸比对相似度不足 | 返回 `{ passed: false, confidence, reason }` |
| 网络超时/API 限流 | 上层 `kyc.service.ts` 有重试逻辑 |

---

## 5. 与客户端交互流程

```
Client                  API                             AWS/GCP
  │                      │                                │
  │  1. POST /kyc/session │                                │
  │─────────────────────▶│  CreateFaceLivenessSession      │
  │                      │───────────────────────────────▶│
  │  { sessionId }       │                                │
  │◀─────────────────────│                                │
  │                      │                                │
  │  2. 用户录制活体视频   │                                │
  │     (使用 AWS 提供的  │                                │
  │      Liveness SDK)   │                                │
  │                      │                                │
  │  3. POST /kyc/submit │                                │
  │  { sessionId,        │                                │
  │    idCardImage }     │                                │
  │─────────────────────▶│                                │
  │                      │  GetLivenessSessionResults     │
  │                      │───────────────────────────────▶│
  │                      │◀───────────────────────────────│
  │                      │                                │
  │                      │  Gemini OCR                    │
  │                      │───────────────────────────────▶│
  │                      │◀───────────────────────────────│
  │                      │                                │
  │                      │  CompareFaces                  │
  │                      │───────────────────────────────▶│
  │                      │◀───────────────────────────────│
  │  { kycResult }      │                                │
  │◀─────────────────────│                                │
```

---

## 6. 安全与合规要点

- **身份证图片不留存**: OCR 完成后立即丢弃 Buffer，不持久化原始证件照
- **Session Token 一次性**: `CreateFaceLivenessSession` 返回的 SessionId 只能使用一次
- **活体视频不留存**: AWS Rekognition 默认在结果生成后自动删除视频数据
- **FraudScore 阈值**: Gemini 返回的欺诈分数存储在 KYC 记录中，用于人工审核参考
- **Cyrillic 字体补丁**: 特定地区的身份证使用非拉丁字母时，降低欺诈检测敏感度

---

## 总结

`KycProviderService` 通过 **AWS Rekognition** 与 **Vertex AI Gemini** 的双云组合，实现了完整的 KYC 身份核验流水线。核心设计原则：

1. **职责分离**: OCR（Gemini）与活体检测（AWS）各自独立，互不影响
2. **零温度输出**: Gemini 以 `temperature=0` 运行，确保 OCR 结果可复现
3. **容错降级**: `extractJsonObject()` 处理 Gemini 输出格式不稳定；Cyrillic 字体补丁处理假阳性
4. **原子化验证**: 三步流水线（创建 Session → 验证活体 → 比对人脸）各步骤独立可重试
