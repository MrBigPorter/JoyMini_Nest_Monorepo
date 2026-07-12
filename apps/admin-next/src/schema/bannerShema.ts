import { z } from 'zod';
import { imageFileSchema } from '@/schema/index';
import { JUMP_CATE } from '@/lib/locale-constants';

export const BannerShema = z
  .object({
    title: z.string().min(1, 'Title is required').max(200),
    bannerImgUrl: imageFileSchema,
    fileType: z.coerce.number().int(), // 1 image 2 video
    bannerCate: z.number().min(1), // 1 home 2 activity 3 product 4 custom
    jumpCate: z.number(), // 0 none 1 treasure 2 category 3 external link
    jumpUrl: z.string().optional().or(z.literal('')),

    //relatedTitleId: z.string().optional(),
    sortOrder: z.coerce.number().int(),

    activityAtStart: z.date().optional().nullable(),
    activityAtEnd: z.date().optional().nullable(),
    relatedTitleId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    console.log('refine data:', data);
    if (Number(data.jumpCate) === JUMP_CATE.TREASURE && !data.relatedTitleId) {
      return ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Related title ID must be provided when jump category is TREASURE',
        path: ['relatedTitleId'],
      });
    }
  });

export type BannerFormInputs = z.infer<typeof BannerShema>;
