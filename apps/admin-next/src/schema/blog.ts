import { z } from 'zod';

// Article
export const articleSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(200, '标题最多200字符'),
  content: z.string().min(1, '内容不能为空'),
  excerpt: z.string().max(500, '摘要最多500字符').optional(),
  categoryId: z.string().optional(),
  tagIds: z.array(z.string()).default([]),
  status: z.enum(['draft', 'published', 'scheduled']).default('draft'),
  featuredImage: z
    .string()
    .url('请提供有效的图片URL')
    .optional()
    .or(z.literal('')),
});

export type ArticleFormInputs = z.infer<typeof articleSchema>;

// Category
export const categorySchema = z.object({
  name: z.string().min(1, '分类名称不能为空').max(50, '分类名称最多50字符'),
  slug: z
    .string()
    .min(1, 'Slug不能为空')
    .max(50, 'Slug最多50字符')
    .regex(/^[a-z0-9\-]+$/, 'Slug只能包含小写字母、数字和连字符'),
  description: z.string().max(500, '描述最多500字符').optional(),
});

export type CategoryFormInputs = z.infer<typeof categorySchema>;

// Tag
export const tagSchema = z.object({
  name: z.string().min(1, '标签名称不能为空').max(30, '标签名称最多30字符'),
  color: z
    .string()
    .regex(
      /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
      '颜色必须为十六进制格式，例如 #3b82f6',
    )
    .optional(),
  description: z.string().max(300, '描述最多300字符').optional(),
});

export type TagFormInputs = z.infer<typeof tagSchema>;

// Comment moderation
export const commentModerationSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'SPAM', 'PENDING']),
  reply: z.string().max(1000, '回复内容最多1000字符').optional(),
});

export type CommentModerationInputs = z.infer<typeof commentModerationSchema>;
