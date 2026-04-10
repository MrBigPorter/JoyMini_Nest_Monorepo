import { z } from 'zod';
import { localizedStringSchema } from '@lucky/shared';

// Article
export const articleSchema = z.object({
  title: localizedStringSchema(
    z
      .string()
      .min(1, 'Title is required')
      .max(200, 'Title must be at most 200 characters'),
  ),
  content: localizedStringSchema(z.string().min(1, 'Content is required')),
  excerpt: localizedStringSchema(
    z.string().max(500, 'Excerpt must be at most 500 characters').optional(),
  ),
  categoryId: z.string().optional(),
  tagIds: z.array(z.string()).default([]),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
  featuredImage: z
    .union([
      z.string().url('Please enter a valid image URL'),
      z.instanceof(File),
    ])
    .optional(),
});

export type ArticleFormInputs = z.infer<typeof articleSchema>;

// Category
export const categorySchema = z.object({
  name: z
    .string()
    .min(1, 'Category name is required')
    .max(50, 'Category name must be at most 50 characters'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(50, 'Slug must be at most 50 characters')
    .regex(
      /^[a-z0-9\-]+$/,
      'Slug can only contain lowercase letters, numbers, and hyphens',
    ),
  description: z
    .string()
    .max(500, 'Description must be at most 500 characters')
    .optional(),
});

export type CategoryFormInputs = z.infer<typeof categorySchema>;

// Tag
export const tagSchema = z.object({
  name: z
    .string()
    .min(1, 'Tag name is required')
    .max(30, 'Tag name must be at most 30 characters'),
  color: z
    .string()
    .regex(
      /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
      'Color must be a valid hex code, e.g., #3b82f6',
    )
    .optional(),
  description: z
    .string()
    .max(300, 'Description must be at most 300 characters')
    .optional(),
});

export type TagFormInputs = z.infer<typeof tagSchema>;

// Comment moderation
export const commentModerationSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'SPAM', 'PENDING']),
  reply: z
    .string()
    .max(1000, 'Reply must be at most 1000 characters')
    .optional(),
});

export type CommentModerationInputs = z.infer<typeof commentModerationSchema>;
