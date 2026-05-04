---
title: "全栈 KYC 身份验证——Flutter 拍照 → Gemini OCR → AWS 活体 → Admin 审核"
slug: "full-stack-kyc-verification"
date: "2026-05-03"
description: "追踪 KYC 完整数据管道：Flutter 端拍照上传 → NestJS API 编排 Gemini AI OCR + AWS Rekognition 活体检测 + 人证比对 → admin-next 双栏审核，涵盖欺诈检测、冷却策略、分布式锁等生产级设计"
tags: ["admin-next", "Flutter", "NestJS", "KYC", "AWS Rekognition", "Gemini AI", "OCR", "liveness-detection", "fraud-detection", "distributed-lock"]
---

# 全栈 KYC 身份验证——Flutter 拍照 → Gemini OCR → AWS 活体 → Admin 审核

## 1. 架构全景

KYC（Know Your Customer）是本平台最复杂的全栈管道之一，横跨四个子系统：

```
┌─────────────────────────────────────────────────────────────────┐
│  Flutter App                                                     │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────────┐      │
│  │ KycGuard   │  │ KycVerifyPage│  │ KYC Confirm Page   │      │
│  │ .ensure()  │→ │ 选择证件类型  │→ │ OCR 数据确认 +     │      │
│  │ 状态路由    │  │ 拍照 → OCR   │  │ 地址选择 → Submit  │      │
│  │            │  │ 活体采集     │  │                    │      │
│  └────────────┘  └──────────────┘  └──────────┬─────────┘      │
│                                               │                 │
└───────────────────────────────────────────────┼─────────────────┘
                                                 │ HTTP / Multipart
                                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  NestJS API  (apps/api/src/client/kyc/)                         │
│                                                                  │
│  POST /kyc/session  ──────►  KycLivenessSession (Prisma)       │
│  POST /kyc/ocr-scan ──────►  KycProviderService.ocrIdCard()    │
│  POST /kyc/submit   ──────►  KycService.submitKyc()            │
│                                ├─ Gemini OCR (AI)              │
│                                ├─ AWS Rekognition (Liveness)   │
│                                ├─ AWS Rekognition (Face Match) │
│                                └─ Upload to S3                 │
│                                                                  │
│  Rate Limiting: @Throttle + @DistributedLock                    │
│  Device Security: @DeviceSecurity(LOG_ONLY)                     │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  External Providers                                              │
│  ┌─────────────────┐  ┌──────────────────┐                      │
│  │  Gemini AI       │  │  AWS Rekognition │                      │
│  │  OCR + Fraud     │  │  Liveness + Face │                      │
│  │  Detection       │  │  Matching        │                      │
│  └─────────────────┘  └──────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  admin-next  (apps/admin-next/src/views/kyc/)                   │
│                                                                  │
│  KycAuditModal ── 双栏证据审查                                    │
│  ├─ 左栏: 身份证正反面 + 活体照片 + 活体视频                     │
│  ├─ 右栏: OCR 数据比对 + 活体评分 + 决策区域                     │
│  └─ 操作: Approve / Reject / Need_More                           │
│                                                                  │
│  KycFormModal ── 管理员手动创建/编辑 KYC 记录                    │
│  └─ mode: 'create' | 'edit'                                      │
└─────────────────────────────────────────────────────────────────┘
```

本文将以**数据流向**为主线，追踪一张证件照片从 Flutter 相机到 Admin 审核的全过程。

---

## 2. Flutter 端认证屏障——KycGuard 状态机路由

KYC 系统在 Flutter 端的入口是 [`KycGuard`](../../JoyMini_Flutter_App/lib/core/guards/kyc_guard.dart)，它是一个**状态机路由守卫**，而非简单的认证检查：

```dart
class KycGuard {
  static void ensure({
    required BuildContext context,
    required WidgetRef ref,
    required VoidCallback onApproved,
  }) {
    final kycStatus = ref.read(
      userProvider.select((state) => state?.kycStatus ?? 0),
    );
    final statusEnum = KycStatusEnum.fromStatus(kycStatus);

    switch (statusEnum) {
      case KycStatusEnum.approved:
        onApproved();              // ✅ 已通过，执行回调
        break;
      case KycStatusEnum.reviewing:
        _showPendingSheet(context); // ⏳ 审核中，提示等待
        break;
      default:
        _showVerifyModal(context);  // 📸 未认证，弹出认证引导
    }
  }
}
```

**三种状态的三种行为**：

| 状态 | 行为 | 用户看到的UI |
|------|------|------------|
| `approved` (4) | 直接执行回调 | 无感继续操作 |
| `reviewing` (1) | `_showPendingSheet` → RadixSheet | 审核中提示弹窗 |
| `draft/rejected/needMore` (0/2/3/5) | `_showVerifyModal` → `appRouter.push('/me/kyc/verify')` | 引导认证弹窗 |

`KycGuard` 被集成到多个需要 KYC 的业务入口：

- [`payment_page_logic.dart`](../../JoyMini_Flutter_App/lib/app/page/payment/payment_page_logic.dart:166) — 支付前检查 KYC 状态
- [`withdraw_page_logic.dart`](../../JoyMini_Flutter_App/lib/app/page/withdraw/withdraw_page_logic.dart:51) — 提现前检查 KYC+VIP
- [`purchase_state_provider.dart`](../../JoyMini_Flutter_App/lib/core/providers/purchase_state_provider.dart:318) — 购买前检查

### 2.1 状态枚举对齐

KYC 状态定义在 [`kyc.dart`](../../JoyMini_Flutter_App/lib/core/models/kyc.dart:87)，与后端 Prisma `KYC_STATUS` 常量严格对齐：

```dart
enum KycStatusEnum {
  draft(0, KycStatusLabel.draft),
  reviewing(1, KycStatusLabel.reviewing),
  rejected(2, KycStatusLabel.rejected),
  needMore(3, KycStatusLabel.needMore),
  approved(4, KycStatusLabel.approved),
  autoRejected(5, KycStatusLabel.autoRejected);
}
```

### 2.2 KYC 验证总页面——KycVerifyPage

当用户进入验证流程后，[`KycVerifyPage`](../../JoyMini_Flutter_App/lib/app/page/kyc_verify/kyc_verify_page.dart) 管理完整的四步流程：

```
KycVerifyPage
┌─────────────────────────────────────┐
│ Step 1: 选择证件类型                  │
│ RadixSheet → SelectIdType           │
│                                     │
│ Step 2: 拍照扫描                      │
│ LivenessService.scanDocument()      │
│ → UnifiedKycGuard.check() 本地校验   │
│ → uploadOcrScan() 上传 → OCR API    │
│                                     │
│ Step 3: 欺诈风险检测                  │
│ fraudScore > 90 → 拦截              │
│ fraudScore > 60 → 确认弹窗           │
│                                     │
│ Step 4: 信息确认页                    │
│ KycInformationConfirmPage           │
│ → 预填 OCR 数据                      │
│ → 地址三级联动 (Province/City/Barangay)│
│ → submitKyc()                       │
└─────────────────────────────────────┘
```

业务逻辑抽取在 [`kyc_verify_logic.dart`](../../JoyMini_Flutter_App/lib/app/page/kyc_verify/kyc_verify_logic.dart) Mixin 中，核心欺诈风控：

```dart
Future<bool> _validateRiskScore(KycOcrResult r) async {
  final score = r.fraudScore;
  if (score > 90) {           // 高欺诈 → 直接拦截
    _showFraudBlockedDialog(r);
    return false;
  }
  if (score > 60) {           // 中等欺诈 → 用户确认
    return await _showFraudWarningDialog(r);
  }
  return true;                // 低风险 → 自动通过
}
```

---

## 3. 后端 KYC Provider——Gemini OCR + AWS Rekognition

[`KycProviderService`](../../apps/api/src/common/kyc-provider/kyc-provider.service.ts) 是整个 KYC 系统的 AI 引擎，集成了两个云服务商：

### 3.1 Gemini AI OCR 管道

```typescript
// kyc-provider.service.ts:170
private async extractWithGemini(
  imageBuffer: Buffer,
): Promise<IdCardResult> {
  const model = this.googleGenerativeAI.getGenerativeModel({
    model: 'gemini-1.5-pro',
  });

  const prompt = `Extract identity document information...
    Rules:
    1. type: must be one of DRIVERS_LICENSE, PASSPORT, PRC_ID, UMID, SSS, TIN, PHILHEALTH, POSTAL_ID, VOTERS_ID, NATIONAL_ID, NATIONAL_ID_BACK, SCHOOL_ID, OTHERS, UNKNOWN
    2. idNumber, names, gender, birthday, expiryDate
    3. country: two-letter code
    4. isSuspicious: true if any manipulation detected
    5. fraudScore: 0-100 confidence of forgery
    6. fraudReasons: list of suspicious observations
    ...`;
```

Gemini Prompt 工程的关键设计：

- **严格枚举约束**：证件类型限定为菲律宾政府 ID 列表（PRC_ID, UMID, SSS, TIN, PHILHEALTH, POSTAL_ID, VOTERS_ID, NATIONAL_ID）
- **欺诈检测指令**：要求 AI 分析图像篡改、PS 痕迹、屏幕翻拍
- **学生证拒绝**：明确指示 `type: SCHOOL_ID` → 转为 UNKNOWN
- **字体容忍**：处理 Cyrillic 字体误判补丁

**OCR 响应 → 强类型映射**：

```typescript
interface IdCardResult {
  type: KycIdCardType;          // 强类型枚举
  typeText: string;             // 原始文本
  country: string;
  names: string;                // 原始姓名字段
  firstName: string | null;     // 拆分后的名
  middleName: string | null;    // 拆分后的中间名
  lastName: string | null;      // 拆分后的姓
  idNumber: string | null;
  gender: string | null;
  birthday: string | null;      // 归一化日期
  expiryDate: string | null;
  isSuspicious: boolean;        // AI 可疑标记
  fraudScore: number;           // 0-100 欺诈评分
  fraudReasons: string[];       // 可疑理由
}
```

### 3.2 Cyrillic 字体误判补丁

Gemini 有时会将某些证件的字体装饰误判为 "Cyrillic" 导致误报。解决方案：

```typescript
// kyc-provider.service.ts:316
// Cyrillic font false positive patch
if (
  reason.toLowerCase().includes('cyrillic') ||
  reason.toLowerCase().includes('font') ||
  reason.toLowerCase().includes('mixed script') ||
  reason.toLowerCase().includes('alphabet')
) {
  if (score < 85) {
    fraudScore = 20;       // 强制降分
    isSuspicious = false;  // 移除可疑标记
  }
}
```

阈值判断：只有 OCR 自信度 **≥85%** 时，Cyrillic 判定才被采信；否则认为是字体装饰导致的 AI 误判。

### 3.3 姓名拆分系统

菲律宾人名的结构复杂（first + middle + last），Gemini 可能返回不同格式。系统的 [`splitName`](../../apps/api/src/common/kyc-provider/kyc-provider.service.ts:491) 处理两种格式：

```
"Maria, Juan Dela Cruz"  → comma-separated (last, first middle)
  → firstName: "Juan", middleName: "Dela Cruz", lastName: "Maria"

"Juan Dela Cruz Maria"   → space-separated
  → firstName: "Juan", middleName: "Dela Cruz", lastName: "Maria"
```

### 3.4 日期归一化

```typescript
// kyc-provider.service.ts:466
private normalizeDate(v: any): string | null {
  if (!v) return null;

  // 1) ISO 8601 → 'YYYY-MM-DD'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    return v.slice(0, 10);
  }
  // 2) Unix timestamp (milliseconds)
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
    const ms = typeof v === 'number' ? v : parseInt(v, 10);
    return dayjs(ms).format('YYYY-MM-DD');
  }
  // 3) Date object
  if (v instanceof Date) {
    return dayjs(v).format('YYYY-MM-DD');
  }
  // 4) Fallback: try dayjs parse
  const parsed = dayjs(v);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
}
```

### 3.5 AWS Rekognition 活体检测

活体检测（Liveness Detection）是防伪的核心，防止照片/视频冒充：

```typescript
// kyc-provider.service.ts:339
async verifyLivenessAndMatchIdCard(
  userId: string,
  sessionId: string,
  idCardBuffer: Buffer,
) {
  // Phase 1: Get session results from Rekognition
  const sessionResult = await this.rekognition.send(
    new GetFaceLivenessSessionResultsCommand({
      SessionId: sessionId,
    }),
  );

  const livenessConfidence =
    sessionResult.Confidence ?? 0;
  const passed =
    livenessConfidence >= this.livenessPassScore; // 默认 85

  if (!passed) {
    return { passed: false, reason: `Liveness too low (${livenessConfidence})` };
  }

  // Phase 2: Face match — compare liveness face with ID card face
  const imageBytes = await sharp(idCardBuffer)
    .jpeg({ quality: 80 })
    .toBuffer();

  const matchResult = await this.rekognition.send(
    new CompareFacesCommand({
      SourceImage: { Bytes: imageBytes },         // ID card face
      TargetImage: {
        Bytes: sessionResult.ReferenceImage!.Bytes!, // Liveness face
      },
      SimilarityThreshold: this.faceMatchScore,   // 默认 90
    }),
  );

  const match = matchResult.FaceMatches?.[0];
  const similarity = match?.Similarity ?? 0;
  const passed =
    similarity >= this.faceMatchScore;

  return {
    passed,
    reason: passed ? undefined : `Face match too low (${similarity})`,
    livenessConfidence,
    referenceImageBytes: sessionResult.ReferenceImage?.Bytes,
  };
}
```

**三段式验证**：

```
Liveness Session (Create)
        │
        ▼
GetFaceLivenessSessionResults ──► Confidence ≥ 85? ── NO ──► FAIL
        │ YES
        ▼
CompareFaces (ID Card vs Liveness Photo)
        │
        ▼
Similarity ≥ 90? ── NO ──► FAIL
        │ YES
        ▼
PASS → 返回 referenceImage (上传至 S3 作为 faceImage)
```

---

## 4. 客户端 KYC Service——会话管理与事务提交

[`KycService`](../../apps/api/src/client/kyc/kyc.service.ts) 封装了客户端 KYC 的业务逻辑，包括会话创建、OCR 扫描和最终提交。

### 4.1 会话创建——冷却策略与复用窗口

```typescript
// kyc.service.ts:50
async createSession(userId: string) {
  const DAILY_LIMIT = 2;              // 每天最多 2 次
  const REUSE_WINDOW_MINUTES = 10;    // 10 分钟内复用已有 session
  const REJECT_COOLDOWN_HOURS = 72;   // 普通拒绝后冷却 3 天
  const PENALTY_COOLDOWN_DAYS = 7;    // 多次拒绝惩罚冷却 7 天
  const PENALTY_WINDOW_DAYS = 30;     // 30 天窗口期
  const PENALTY_REJECT_COUNT = 2;     // 拒绝次数 ≥ 2 触发惩罚

  // 检查当前状态
  if (latestKyc?.kycStatus === KYC_STATUS.REVIEWING) {
    throw new BadRequestException('KYC is under review');
  }
  if (latestKyc?.kycStatus === KYC_STATUS.APPROVED) {
    throw new BadRequestException('KYC already approved');
  }

  // 冷却期检查
  if (latestKyc?.kycStatus === KYC_STATUS.REJECTED) {
    if (rejectCount >= PENALTY_REJECT_COUNT) {
      // 惩罚冷却 7 天
      checkCooldown(PENALTY_COOLDOWN_DAYS, 'day');
    } else {
      // 普通冷却 72 小时
      checkCooldown(REJECT_COOLDOWN_HOURS, 'hour');
    }
  }

  // 每日限制
  if (todayCount >= DAILY_LIMIT) {
    throw new BadRequestException('Daily limit reached (2/day)');
  }

  // 复用窗口：10 分钟内未使用的 session 直接复用
  const reusableSession = await findReusableSession(userId);
  if (reusableSession) return { sessionId, reused: true };

  // 创建新 session → AWS Rekognition
  const session = await this.kycProvider.createLivenessSession(userId);
  await this.prismaService.kycLivenessSession.upsert({...});

  return { sessionId: session.sessionId, reused: false };
}
```

**冷却策略矩阵**：

| 条件 | 冷却时间 | 说明 |
|------|---------|------|
| 正在审核中 | 不允许创建 | 等审核结果 |
| 已通过 | 永久锁定 | 无需再次 KYC |
| 拒绝 < 2 次 / 30 天 | 72 小时 | 标准冷却 |
| 拒绝 ≥ 2 次 / 30 天 | 7 天 | 惩罚冷却 |
| 每日限制 | 2 次/天 | 防止暴力尝试 |

### 4.2 OCR 扫描——Fail Fast + 风控拦截

```typescript
// kyc.service.ts:242
async scanIdCard(buffer: Buffer) {
  // 1) 文件大小校验（Fail Fast）
  await this.validateImageSize(buffer, 'OCR Scan File');

  // 2) 调 AI 做 OCR
  const result = await this.kycProvider.ocrIdCardByBuffer(buffer);

  // 3) 高欺诈拦截（不给用户回填机会）
  if (result.isSuspicious && result.fraudScore > 90) {
    throw new BadRequestException(
      'The uploaded ID card image appears to be invalid.',
    );
  }
  return result;
}
```

注意这里的双重校验：Flutter 端做了本地欺诈检查（前端 UX），API 端做服务器强制拦截（安全底线）。两者不一定同时触发，Flutter 端 UI 友好，API 端是硬性边界。

### 4.3 Submit KYC——Prisma 事务中的并行管道

[`submitKyc`](../../apps/api/src/client/kyc/kyc.service.ts:265) 是最复杂的接口，使用 Prisma `$transaction` 确保原子性：

```typescript
async submitKyc(userId, dto, frontFile, backFile, device) {
  // 1) 文件校验
  await this.validateImageSize(frontFile.buffer, 'ID Card Front');
  if (backFile) await this.validateImageSize(backFile.buffer, 'ID Card Back');

  // 2) ID Type 校验
  const idType = await this.prismaService.kycIdType.findFirst({
    where: { id: dto.idType, status: 1 },
  });
  if (!idType) throw new BadRequestException('Invalid ID type');

  return this.prismaService.$transaction(async (ctx) => {
    // Step A: Session 校验（不消耗 session）
    const session = await ctx.kycLivenessSession.findUnique({...});
    if (!session || session.userId !== userId) throw new ConflictException();
    if (session.usedAt) throw new ConflictException('Already used');

    // Step B: 全局身份证号去重
    const duplicate = await ctx.kycRecord.findFirst({
      where: { idNumber: dto.idNumber, userId: { not: userId },
               kycStatus: { in: [REVIEWING, APPROVED] } },
    });
    if (duplicate) throw new ConflictException('ID already in use');

    // Step C: 本人最新 KYC 状态
    if (existing?.kycStatus === APPROVED) throw new BadRequestException();
    if (existing?.kycStatus === REVIEWING) throw new BadRequestException();

    // Step D: ⚡ 原子占用 session（防并发复用）
    const claimedAt = new Date();
    const claim = await ctx.kycLivenessSession.updateMany({
      where: { sessionId: dto.sessionId, userId, usedAt: null },
      data: { usedAt: claimedAt },
    });
    if (claim.count !== 1) throw new ConflictException();

    try {
      // Step E: 🚀 并行管道
      const [verificationResult, frontUpload, backUpload] = await Promise.all([
        // 任务 1: AI 算力 —— 活体验证 + 人证比对
        this.kycProvider.verifyLivenessAndMatchIdCard(
          userId, dto.sessionId, frontFile.buffer,
        ),
        // 任务 2: S3 IO —— 上传身份证正面
        this.uploadService.uploadBuffer(
          frontFile.buffer, 'kyc', userId, frontFile.mimetype, 'id-card-front',
        ),
        // 任务 3: S3 IO —— 上传身份证反面（可选）
        backFile
          ? this.uploadService.uploadBuffer(
              backFile.buffer, 'kyc', userId, backFile.mimetype, 'id-card-back',
            )
          : Promise.resolve(null),
      ]);

      // Step F: 自动判定初始状态
      let initialStatus = KYC_STATUS.REVIEWING;
      if (!passed) {
        initialStatus = KYC_STATUS.REJECTED; // AI 自动拒绝
      } else {
        // 上传活体 reference image 作为 faceImage
        const { key } = await this.uploadService.uploadBuffer(
          Buffer.from(referenceImageBytes), 'kyc', userId, 'image/jpeg', 'face-image',
        );
        faceImageKey = key;
      }

      // Step G: 创建 KYC Record
      const record = await ctx.kycRecord.create({...});

      // Step H: 同步用户状态
      await ctx.user.update({
        where: { id: userId },
        data: { kycStatus: initialStatus },
      });

      return record;
    } catch (error) {
      // Step I: ⚠️ 手动回滚 session claim
      await ctx.kycLivenessSession.updateMany({
        where: { sessionId: dto.sessionId, userId, usedAt: claimedAt },
        data: { usedAt: null },
      });
      throw error;
    }
  }, {
    maxWait: 5000,   // 等锁最多 5 秒
    timeout: 20000,  // 事务超时 20 秒（AI 耗时）
  });
}
```

**事务中的并行加速**是关键优化：AI 活体验证（算力密集）和 S3 文件上传（IO 密集）通过 `Promise.all` 并发执行，将 3 个串行步骤压缩到约等于其中最慢的一个。

**`usedAt` 原子占用**机制防止同一 session 被并发复用——这是分布式锁之外的数据库级安全网。

---

## 5. 安全与限流——多层防御

### 5.1 分布式锁

KYC 接口使用 `@DistributedLock` 装饰器实现 Redis 分布式锁：

```typescript
// kyc.controller.ts
@Post('session')
@DistributedLock('kyc:session:create:{0}', 15000) // 每用户 15 秒锁
async createSession(@CurrentUserId() userId: string) { ... }

@Post('ocr-scan')
@DistributedLock('kyc:ocr-scan:{0}', 10000)       // 每用户 10 秒锁
scanOcr(...) { ... }

@Post('submit')
@DistributedLock('kyc:submit:{0}', 10000)          // 每用户 10 秒锁
async submitKyc(...) { ... }
```

锁 Key 中的 `{0}` 被替换为 `userId`，确保每个用户的操作互不影响。

### 5.2 接口限流

```typescript
@Post('session')
@Throttle({ kycSessionRequest: { limit: 1, ttl: 60_000 } }) // 1次/分钟
async createSession(...) { ... }

@Post('ocr-scan')
@Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5次/分钟
scanOcr(...) { ... }
```

### 5.3 设备安全

```typescript
@UseGuards(JwtAuthGuard, DeviceSecurityGuard)
@DeviceSecurity(DeviceSecurityLevel.LOG_ONLY) // KYC 级别记录不阻断
@Controller('kyc')
```

设备安全使用 `LOG_ONLY` 级别——记录设备指纹但不强制阻断（与提现操作的 `STRICT_CHECK` 级别不同）。

### 5.4 防御深度总结

| 层 | 机制 | 位置 |
|----|------|------|
| 物理 | 活体检测 + 人证比对 | AWS Rekognition |
| AI | 欺诈评分 + 图像分析 | Gemini AI |
| 本地 | UnifiedKycGuard 本地校验 | Flutter |
| 限流 | @Throttle + @DistributedLock | API Controller |
| 事务 | 原子 session claim + 回滚 | Prisma Transaction |
| 去重 | 全局身份证号唯一性检查 | DB Query |
| 冷却 | 72h/7d 冷却策略 | Service Logic |

---

## 6. Admin 后台 KYC 管理

### 6.1 审核列表与详情

[`AdminKycService`](../../apps/api/src/admin/kyc/kyc.service.ts#L33) 提供带过滤和分页的列表接口：

```typescript
async getKycRecordList(dto: QueryKycDto) {
  const whereConditions: Prisma.KycRecordWhereInput = {};
  // 支持按状态、用户ID、证件类型、日期范围筛选

  const [total, records] = await this.prismaService.$transaction([
    this.prismaService.kycRecord.count({ where: whereConditions }),
    this.prismaService.kycRecord.findMany({
      where: whereConditions,
      include: { user: { select: { nickname: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      skip, take: pageSize,
    }),
  ]);

  // 生成 S3 签名 URL（并行）
  const list = await Promise.all(
    records.map((record) => this.transformRecord(record)),
  );
  return { total, list, page, pageSize };
}
```

`transformRecord` 方法并行生成三个图片的 S3 签名 URL，并清洗 OCR 数据中的敏感路径：

```typescript
private async transformRecord(record: any) {
  const [idCardFrontUrl, idCardBackUrl, faceImage] = await Promise.all([
    record.idCardFront
      ? this.uploadService.getDownloadUrl(record.idCardFront, 'kyc', record.userId),
      : null,
    // ... 其他图片
  ]);
  return {
    ...record,
    idCardFront: idCardFrontUrl,
    idCardBack: idCardBackUrl,
    faceImage,
    ocrRawData: this.sanitizeOcrData(record.ocrRawData),
  };
}
```

### 6.2 审核操作——事务 + 日志

[`adminAudit`](../../apps/api/src/admin/kyc/kyc.service.ts:155) 在单个 Prisma 事务中完成三步操作：

```typescript
async adminAudit(kycId, dto, adminId, ip) {
  return this.prismaService.$transaction(async (ctx) => {
    // 1) 校验
    const record = await ctx.kycRecord.findUnique({ where: { id: kycId } });
    if (record.kycStatus !== KYC_STATUS.REVIEWING) {
      throw new BadRequestException('Not under review');
    }

    // 2) 更新 KYC Record + 更新用户状态
    await ctx.kycRecord.update({ where: { id: kycId }, data: {...} });
    await ctx.user.update({ where: { id: record.userId }, data: {...} });

    // 3) 记录操作日志
    await ctx.adminOperationLog.create({
      data: {
        adminId, adminName: admin.username,
        module: OpModule.USER,
        action: OpAction.USER.KYC_AUDIT,
        details: JSON.stringify({ kycId, action, userId: record.userId,
          from: record.kycStatus, to: nextStatus, remark: dto.remark }),
        requestIp: ip,
      },
    });
  });
}
```

三种审核动作的映射：

| `action` | KYC Status | 说明 |
|----------|-----------|------|
| `APPROVE` | `APPROVED` (4) | 通过审核 |
| `REJECT` | `REJECTED` (2) | 拒绝（需填写原因） |
| `NEED_MORE` | `NEED_MORE` (3) | 要求补充材料 |

### 6.3 管理员其他操作

[`AdminKycService`](../../apps/api/src/admin/kyc/kyc.service.ts) 提供完整的 CRUD：

| API | 方法 | 权限 | 说明 |
|-----|------|------|------|
| `GET /admin/kyc/records` | `list` | USER.VIEW | 列表+过滤 |
| `GET /admin/kyc/records/:id` | `detail` | USER.VIEW | 详情 |
| `POST /admin/kyc/:id/audit` | `adminAudit` | USER.KYC_AUDIT | 审核 |
| `PUT /admin/kyc/update/:userId` | `updateKycInfo` | USER.UPDATE | 更新信息 |
| `POST /admin/kyc/revoke/:userId` | `revokeKyc` | USER.UPDATE | 撤销通过 |
| `DELETE /admin/kyc/delete/:userId` | `deleteKyc` | USER.DELETE | 删除记录 |
| `POST /admin/kyc/create` | `createKycByAdmin` | USER.CREATE | 手动创建 |

权限控制使用 [`@RequirePermission`](apps/api/src/admin/kyc/kyc.controller.ts:39) 装饰器，与 `PermissionsGuard` 配合。所有写操作都写入 `AdminOperationLog`，形成完整的可追溯审计链。

### 6.4 审核 UI——admin-next KycAuditModal

admin-next 的 [`KycAuditModal`](../../apps/admin-next/src/views/kyc/KycAuditModal.tsx) 实现了**双栏证据审查**布局：

```
┌──────────────────────────────────┬──────────────────────────────┐
│  LEFT: Evidence Area              │  RIGHT: Information + Action │
│                                   │                              │
│  ┌──────┐  ┌──────┐             │  InfoRow (OCR 比对)          │
│  │ Front│  │ Back │             │  姓名    █ 绿色 ── 匹配      │
│  └──────┘  └──────┘             │  身份证号 █ 琥珀 ── 不匹配   │
│                                   │  生日    █ 绿色 ── 匹配      │
│  ┌──────┐  ┌──────┐             │                              │
│  │ Face │  │Video │             │  ⚠️ 风险提示（ID 不匹配）    │
│  └──────┘  └──────┘             │                              │
│                                   │  Remark Textarea             │
│  Live Score: ██ 92/100           │                              │
│                                   │  [✕] [?] [✓ Approve]       │
└──────────────────────────────────┴──────────────────────────────┘
```

**OCR 数据比对颜色编码**是审核效率的关键：`InfoRow` 的 `subValue` prop 自动比较用户提交值 vs OCR 识别值，匹配显示绿色标签、不匹配显示琥珀色标签，让审核员一眼识别异常。

详见 [`kyc-audit-form-system.md`](./kyc-audit-form-system.md) 对 UI 层的深入分析。

---

## 7. 数据管道——S3 上传与签名 URL

### 7.1 文件存储路径

所有 KYC 文件按用户隔离存储在 S3：

```
uploads/kyc/user_{userId}/
├── id-card-front.{ext}     ← 身份证正面
├── id-card-back.{ext}      ← 身份证反面（可选）
└── face-image.{ext}        ← 活体 reference image（由后端生成）
```

### 7.2 上传流程

上传由 [`UploadService`](../../apps/api/src/common/upload/upload.service.ts) 统一管理：

```typescript
// kyc.service.ts:353
// 在 Promise.all 中并行上传
const frontUploadResult = await this.uploadService.uploadBuffer(
  frontFile.buffer,    // 二进制数据
  'kyc',               // 模块名 → 目录
  userId,              // 用户ID → 子目录
  frontFile.mimetype,  // MIME 类型
  'id-card-front',     // 文件名
);
```

### 7.3 签名 URL 生成

Admin 读取记录时，不会直接将 S3 对象公开，而是生成**临时签名 URL**（presigned URL）：

```typescript
const idCardFrontUrl = await this.uploadService.getDownloadUrl(
  record.idCardFront,  // S3 key
  'kyc',               // 模块
  record.userId,       // 用户归属验证
);
```

这确保了：
- URL 有时效性（默认 1 小时）
- 访问需验证用户归属
- 敏感文件不会永久公开

---

## 8. Flutter KYC 数据模型与 API 集成

### 8.1 数据模型

Flutter 端的 KYC 模型定义在 [`kyc.dart`](../../JoyMini_Flutter_App/lib/core/models/kyc.dart)，使用 `json_serializable` 注解：

```dart
@JsonSerializable(checked: true)
class KycSession {
  final String sessionId;
}

@JsonSerializable(checked: true)
class KycOcrResult {
  final int type;
  final String? typeText;
  final String? idNumber;
  final String? firstName;
  final String? middleName;
  final String? lastName;
  final String? gender;
  final String? birthday;
  final String? country;
  final int fraudScore;
  final bool isSuspicious;
  final List<String> fraudReasons;
}

@JsonSerializable(checked: true, explicitToJson: true)
class SubmitKycDto {
  final String sessionId;
  final int idType;
  final String idNumber;
  final String realName;
  final String firstName;
  final String? middleName;
  final String lastName;
  final int province;
  final int city;
  final int barangay;
  final String? address;
  final String? postalCode;
  final String? idCardFront;
  final String? idCardBack;
  final Map<String, dynamic>? ocrRawData;
}
```

### 8.2 API 调用

API 调用集中在 [`lucky_api.dart`](../../JoyMini_Flutter_App/lib/core/api/lucky_api.dart:481)：

```dart
/// 创建 KYC 活体 session
static Future<KycSession> kycSessionApi() async {
  final res = await Http.post('/api/v1/kyc/session');
  return KycSession.fromJson(res);
}

/// 获取个人 KYC 状态
static Future<KycMe> kycMeApi() async {
  final res = await Http.get('/api/v1/kyc/me');
  return KycMe.fromJson(res);
}

/// 获取支持的证件类型
static Future<List<KycIdTypes>> kycIdTypesApi() async {
  final res = await Http.get('/api/v1/kyc/id-types');
  return parseList<KycIdTypes>(res, (e) => KycIdTypes.fromJson(e));
}

/// 提交 KYC 申请
static Future<KycResponse> kycSubmitApi(SubmitKycDto dto) async {
  // GlobalUploadService.submitKyc → FormData → Http.post
  final responseData = await GlobalUploadService().submitKyc(
    frontImage: XFile(dto.idCardFront!),
    backImage: dto.idCardBack != null ? XFile(dto.idCardBack!) : null,
    dto: dto,
  );
  return KycResponse.fromJson(responseData);
}
```

注意 `kycSubmitApi` 使用 [`GlobalUploadService`](../../JoyMini_Flutter_App/lib/utils/upload/global_upload_service.dart:229) 处理文件上传——它将本地文件路径转换为 `FormData` 的 `MultipartFile`，通过 `Http.post('/api/v1/kyc/submit', data: form)` 提交。

### 8.3 Riverpod Provider

```dart
// kyc_provider.dart
final kycIdTypeProvider = FutureProvider.autoDispose((ref) async {
  return Api.kycIdTypesApi();
});

final kycMeProvider = FutureProvider((ref) async {
  return Api.kycMeApi();
});
```

`kycMeProvider` 在多个页面被用于状态展示（SettingPage、KycStatusPage），并通过 `ref.invalidate(kycMeProvider)` 手动刷新。

---

## 9. 与 C1 推送通知的对比

本系统的 KYC 和 FCM 推送代表了两种不同的全栈架构模式：

| 维度 | KYC（C2） | FCM 推送（C1） |
|------|-----------|---------------|
| 数据流方向 | 客户端 → 服务器 → AI | 服务器 → FCM → 客户端 |
| 调用模式 | 请求-响应（REST） | 事件驱动（EventEmitter） |
| 复杂度来源 | AI 编排 + 事务 + 限流 | 并发推送 + DND + 多入口 |
| 客户端设计 | 状态机路由 (KycGuard) | 3 层分发器 (Dispatcher) |
| 核心挑战 | 防欺诈 + 原子性 | 并发处理 + 幂等性 |
| 外部依赖 | AWS Rekognition + Gemini | Firebase Cloud Messaging |

---

## 10. 总结

全栈 KYC 系统展示了从**用户拍照到管理员审核**的完整数据管道，核心设计要点：

1. **三层校验防御**：Flutter 本地检查 → API 服务端校验 → AWS/Gemini AI 验证
2. **Prisma 事务原子性**：session claim + AI 验证 + S3 上传 + 数据库写入处于同一事务
3. **并行加速**：`Promise.all` 并发执行 AI 算力和 IO 上传
4. **冷却与限流**：多层防御（冷却期 + 日限制 + 分布式锁 + Throttle）
5. **可追溯审计**：所有操作写入 `AdminOperationLog`，图片使用 S3 签名 URL
6. **AI 欺诈检测**：Gemini Prompt 工程 + Cyrillic 补丁 + 评分分级拦截

### 相关文章

- [`kyc-audit-form-system.md`](./kyc-audit-form-system.md) — admin-next KYC 审核 UI 组件双栏布局
- [`end-to-end-push-notification.md`](./end-to-end-push-notification.md) — C1 端到端推送通知（事件驱动架构对比）
- [`ui-components-library.md`](./ui-components-library.md) — admin-next UI 组件库
- [`finance-audit-withdrawal-adjust-workflow.md`](./finance-audit-withdrawal-adjust-workflow.md) — 提现审核工作流（另一类审核弹窗）
