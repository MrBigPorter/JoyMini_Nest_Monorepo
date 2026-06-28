import { Exclude, Expose, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FieldMeta } from '@lucky/shared';

@Exclude()
export class KycResponseDto {
  @FieldMeta({
    label: { zh: 'KYC 状态', en: 'KYC Status' },
    enum: {
      0: { zh: '未提交', en: 'Draft' },
      1: { zh: '审核中', en: 'Reviewing' },
      2: { zh: '审核失败', en: 'Rejected' },
      3: { zh: '待补充', en: 'Need More Info' },
      4: { zh: '已通过', en: 'Approved' },
      5: { zh: '系统拒绝', en: 'Auto Rejected (Risk)' },
    },
  })
  @ApiProperty({
    description:
      'Status: 0-Draft, 1-Reviewing, 2-Rejected, 3-NeedMore, 4-Approved, 5-AutoReject',
  })
  @Expose()
  kycStatus!: number;

  // === 1. 证件核心信息 ===
  @FieldMeta({
    label: { zh: '证件类型', en: 'ID Type' },
    enum: {
      0: { zh: '未知', en: 'Unknown Type' },
      1: { zh: '护照', en: 'Passport' },
      10: { zh: '菲律宾驾照', en: "Driver's License" },
      11: { zh: '菲律宾统一多功能ID', en: 'UMID' },
      12: { zh: '菲律宾国民ID', en: 'PhilSys ID' },
      13: { zh: '菲律宾专业监管委员会ID', en: 'PRC ID' },
      14: { zh: '菲律宾邮政ID', en: 'Postal ID' },
      20: { zh: '中国居民身份证', en: 'Chinese Resident ID' },
      30: { zh: '越南公民身份证', en: 'Vietnamese Citizen ID' },
    },
  })
  @ApiProperty({ description: 'ID Type (1-Passport, etc.)' })
  @Expose()
  idType!: number;

  @FieldMeta({ label: { zh: '身份证号', en: 'ID Number' } })
  @Expose() idNumber?: string;

  @FieldMeta({ label: { zh: '名', en: 'First Name' } })
  @Expose() firstName?: string;

  @FieldMeta({ label: { zh: '中间名', en: 'Middle Name' } })
  @Expose() middleName?: string;

  @FieldMeta({ label: { zh: '姓', en: 'Last Name' } })
  @Expose() lastName?: string;

  @FieldMeta({ label: { zh: '真实姓名', en: 'Real Name' } })
  @Expose() realName?: string;

  @FieldMeta({ label: { zh: '性别', en: 'Gender' } })
  @Expose() gender?: string;

  @FieldMeta({ label: { zh: '出生日期', en: 'Birthday' }, type: 'date' })
  @ApiPropertyOptional({ type: Date })
  @Expose()
  @Type(() => Date)
  birthday?: Date;

  @FieldMeta({ label: { zh: '出生地', en: 'Place of Birth' } })
  @Expose() placeOfBirth?: string;

  @FieldMeta({ label: { zh: '国籍', en: 'Nationality' } })
  @Expose() nationality?: string;

  @FieldMeta({ label: { zh: '证件有效期', en: 'Expiry Date' }, type: 'date' })
  @ApiPropertyOptional({ type: Date })
  @Expose()
  @Type(() => Date)
  expiryDate?: Date;

  @FieldMeta({ label: { zh: '签发日期', en: 'Issue Date' }, type: 'date' })
  @ApiPropertyOptional({ type: Date })
  @Expose()
  @Type(() => Date)
  issueDate?: Date;

  @FieldMeta({ label: { zh: '国家代码', en: 'Country Code' } })
  @Expose() countryCode?: number;

  // === 2. 财务能力 (AMLA) ===
  @FieldMeta({ label: { zh: '收入来源', en: 'Source of Income' } })
  @Expose() sourceOfIncome?: string;

  @FieldMeta({ label: { zh: '职业性质', en: 'Nature of Work' } })
  @Expose() natureOfWork?: string;

  @FieldMeta({ label: { zh: '雇主名称', en: 'Employer Name' } })
  @Expose() employerName?: string;

  // === 3. 地址信息 (Philippines Standard) ===
  @FieldMeta({ label: { zh: '省', en: 'Province' } })
  @Expose() province?: string;

  @FieldMeta({ label: { zh: '市', en: 'City' } })
  @Expose() city?: string;

  @FieldMeta({ label: { zh: '区/村', en: 'Barangay' } })
  @Expose() barangay?: string;

  @FieldMeta({ label: { zh: '邮政编码', en: 'Postal Code' } })
  @Expose() postalCode?: string;

  @FieldMeta({ label: { zh: '地址', en: 'Address' } })
  @Expose() address?: string;

  @FieldMeta({ label: { zh: '是否同地址', en: 'Same Address' } })
  @Expose() isSameAddress!: boolean;

  @FieldMeta({ label: { zh: '当前地址', en: 'Current Address' } })
  @Expose() currentAddress?: any; // Json 字段直接吐给前端

  // === 4. 图片凭证 (S3 Keys) — LLM 不需要看到这些 ===

  // === 5. 风控数据 ===
  @FieldMeta({
    label: { zh: '风险等级', en: 'Risk Level' },
    enum: {
      0: { zh: '低风险', en: 'Low' },
      1: { zh: '中风险', en: 'Medium' },
      2: { zh: '高风险', en: 'High' },
    },
  })
  @Expose() riskLevel!: number;

  // === 6. 设备指纹 ===
  @FieldMeta({ label: { zh: 'IP 地址', en: 'IP Address' } })
  @Expose() ipAddress?: string;

  @FieldMeta({ label: { zh: '设备 ID', en: 'Device ID' } })
  @Expose() deviceId?: string;

  @FieldMeta({ label: { zh: '设备型号', en: 'Device Model' } })
  @Expose() deviceModel?: string;

  @FieldMeta({ label: { zh: 'App 版本', en: 'App Version' } })
  @Expose() appVersion?: string;

  // === 7. 审核反馈 ===
  @FieldMeta({ label: { zh: '审核结果', en: 'Audit Result' } })
  @Expose() auditResult?: string;

  @FieldMeta({ label: { zh: '拒绝原因', en: 'Reject Reason' } })
  @Expose() rejectReason?: string;

  @FieldMeta({ label: { zh: '提交时间', en: 'Submitted At' }, type: 'date' })
  @Expose() @Type(() => Date) submittedAt?: Date;

  @FieldMeta({ label: { zh: '审核时间', en: 'Audited At' }, type: 'date' })
  @Expose() @Type(() => Date) auditedAt?: Date;

  @FieldMeta({ label: { zh: '创建时间', en: 'Created At' }, type: 'date' })
  @Expose() @Type(() => Date) createdAt!: Date;
}
