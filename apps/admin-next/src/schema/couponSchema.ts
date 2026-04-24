import { z } from 'zod';
import { COUPON_TYPE, ISSUE_TYPE, VALID_TYPE } from '@lucky/shared';
import type { TFunc } from '@/hooks/useTranslation';

export function createCouponSchema(t: TFunc) {
  return z
    .object({
      couponName: z
        .string()
        .min(1, t('coupon.validationNameRequired'))
        .max(200, t('coupon.validationNameMaxLength')),
      couponCode: z
        .string()
        .max(50, t('coupon.validationCodeMaxLength'))
        .optional(),
      couponType: z.coerce
        .number()
        .int()
        .refine((v) => [1, 2, 3].includes(v), {
          message: t('coupon.validationCouponTypeInvalid'),
        }),
      discountType: z.coerce
        .number()
        .int()
        .refine((v) => [1, 2].includes(v), {
          message: t('coupon.validationDiscountTypeInvalid'),
        }),
      discountValue: z.coerce
        .number()
        .min(0.01, t('coupon.validationDiscountMin')),
      minPurchase: z.coerce
        .number()
        .min(0, t('coupon.validationMinPurchaseMin')),
      maxDiscount: z.coerce
        .number()
        .min(0, t('coupon.validationMaxDiscountMin'))
        .optional(),
      issueType: z.coerce
        .number()
        .int()
        .refine((v) => [1, 2, 3, 4].includes(v), {
          message: t('coupon.validationIssueTypeInvalid'),
        }),
      totalQuantity: z.coerce
        .number()
        .int()
        .min(-1, t('coupon.validationTotalQuantityMin')),
      perUserLimit: z.coerce
        .number()
        .int()
        .min(1, t('coupon.validationPerUserLimitMin')),
      validType: z.coerce
        .number()
        .int()
        .refine((v) => [1, 2].includes(v), {
          message: t('coupon.validationValidTypeInvalid'),
        }),
      validDays: z.coerce
        .number()
        .int()
        .min(1, t('coupon.validationValidDaysMin'))
        .optional(),
      validStartAt: z
        .date({ required_error: t('coupon.validationStartDateRequired') })
        .optional(),
      validEndAt: z
        .date({ required_error: t('coupon.validationEndDateRequired') })
        .optional(),
      subTitle: z
        .string()
        .max(200, t('coupon.validationSubtitleMaxLength'))
        .optional(),
      description: z
        .string()
        .max(500, t('coupon.validationDescriptionMaxLength'))
        .optional(),
    })
    .superRefine((data, ctx) => {
      // 1. issueType = 3 时，couponCode 必填
      if (+data.issueType === ISSUE_TYPE.REDEEM_CODE) {
        if (!data.couponCode || data.couponCode.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['couponCode'],
            message: t('coupon.validationCodeRequiredRedeem'),
          });
        }
      }
      // 2. couponType = 2 时，discountType 和 maxDiscount 必填
      if (+data.couponType === COUPON_TYPE.DISCOUNT) {
        if (data.maxDiscount === undefined || data.maxDiscount === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['maxDiscount'],
            message: t('coupon.validationMaxDiscountRequired'),
          });
        }
      }
      // 3. validType = 2 时，validDays 必填
      if (+data.validType === VALID_TYPE.DAYS_AFTER_RECEIVE) {
        if (!data.validDays || data.validDays <= 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['validDays'],
            message: t('coupon.validationValidDaysRequired'),
          });
        }
      }

      // 4. validType = 1 时，validStartAt 和 validEndAt 必填，且 validEndAt 要晚于 validStartAt
      if (+data.validType === VALID_TYPE.RANGE) {
        if (!data.validStartAt) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['validStartAt'],
            message: t('coupon.validationStartDateRequiredRange'),
          });
        }
        if (!data.validEndAt) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['validEndAt'],
            message: t('coupon.validationEndDateRequiredRange'),
          });
        }

        if (data.validStartAt && data.validEndAt) {
          if (data.validEndAt.getTime() < data.validStartAt.getTime()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['validEndAt'],
              message: t('coupon.validationEndDateAfterStart'),
            });
          }
        }
      }
      // 5. totalQuantity != -1 时，totalQuantity >= perUserLimit
      if (data.totalQuantity !== -1 && data.totalQuantity < data.perUserLimit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['totalQuantity'],
          message: t('coupon.validationTotalQuantityGtePerUser'),
        });
      }
    });
}

export type CreateCouponSchemaFormInput = z.infer<
  ReturnType<typeof createCouponSchema>
>;
