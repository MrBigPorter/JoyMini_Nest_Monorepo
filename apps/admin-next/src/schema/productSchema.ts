import { z } from 'zod';
// 确保路径正确，如果是同目录下的文件可能不需要 @/schema
import { imageFileSchema } from '@/schema/index';

export const createProductSchema = z.object({
  // --- 1. 基础信息 ---
  treasureName: z.string().min(1, 'Product name is required'),

  // 库存
  seqShelvesQuantity: z.coerce
    .number()
    .min(1, 'Stock quantity must be at least 1'),

  // 拼团价 (核心售价)
  unitAmount: z.coerce.number().min(0.01, 'Unit price must be at least 0.01'),

  // 成本
  costAmount: z.coerce.number().min(0, 'Total cost must be at least 0'),

  // 使用 coerce 允许字符串转数字，如果为空字符串转成 0 或 undefined 由后续逻辑处理
  marketAmount: z.coerce.number().min(0).optional(),

  soloAmount: z.coerce.number().min(0).optional(),

  categoryIds: z.coerce
    .number({
      required_error: 'Category is required',
      invalid_type_error: 'Category must be a number',
    })
    .min(1, 'Category is required'),

  desc: z.string().optional(),
  ruleContent: z.string().optional(),

  treasureCoverImg: imageFileSchema,

  // --- 2. 物流与拼团配置 ---
  shippingType: z.coerce.number(),
  weight: z.coerce.number().optional(),

  groupSize: z.coerce.number().min(2, 'Group size must be at least 2'),

  groupTimeLimit: z.coerce
    .number()
    .min(60, 'Time limit must be at least 60 seconds'),

  enableRobot: z.boolean().optional(),

  // 机器人延迟 (秒)
  robotDelay: z.coerce.number().min(0).optional(),

  // 团长奖励类型
  leaderBonusType: z.coerce.number().optional(),

  // --- 3. 销售时间 ---
  salesStartAt: z
    .union([z.date(), z.string(), z.null(), z.undefined()])
    .optional(),
  salesEndAt: z
    .union([z.date(), z.string(), z.null(), z.undefined()])
    .optional(),

  // --- 4. 赠品配置 (Flattened) ---
  bonusItemName: z.string().optional(),
  bonusWinnerCount: z.coerce.number().min(1, 'At least 1 winner').optional(),
  bonusItemImg: imageFileSchema.optional().or(z.literal('')),
});
