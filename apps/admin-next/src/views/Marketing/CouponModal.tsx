'use client';

import React, { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRequest } from 'ahooks';
import {
  createCouponSchema,
  CreateCouponSchemaFormInput,
} from '@/schema/couponSchema';
import {
  Button,
  Form,
  FormDateField,
  FormSelectField,
  FormTextField,
} from '@repo/ui';
import { FormTextareaField } from '@repo/ui';
import {
  COUPON_TYPE,
  COUPON_TYPE_OPTIONS,
  DISCOUNT_TYPE,
  DISCOUNT_TYPE_OPTIONS,
  ISSUE_TYPE,
  ISSUE_TYPE_OPTIONS,
  VALID_TYPE,
  VALID_TYPE_OPTIONS,
} from '@lucky/shared';
import { couponApi } from '@/api';
import { Coupon, CreateCouponPayload } from '@/type/types'; // Assuming your full Coupon type is here
import type { TFunc } from '@/hooks/useTranslation';

interface CouponFormModalProps {
  close: () => void;
  confirm: () => void;
  editingData?: Coupon;
  t: TFunc;
}

const transformFormToPayload = (
  values: CreateCouponSchemaFormInput,
): CreateCouponPayload => {
  const payload: CreateCouponPayload = {
    ...values,
    discountValue: Number(values.discountValue),
    minPurchase: Number(values.minPurchase),
    totalQuantity: Number(values.totalQuantity),
    perUserLimit: Number(values.perUserLimit),
    couponType: Number(values.couponType) as CreateCouponPayload['couponType'],
    discountType: Number(
      values.discountType,
    ) as CreateCouponPayload['discountType'],
    maxDiscount: values.maxDiscount ? Number(values.maxDiscount) : undefined,
    issueType: Number(values.issueType) as CreateCouponPayload['issueType'],
    validType: Number(values.validType) as CreateCouponPayload['validType'],
    validStartAt: values.validStartAt
      ? new Date(values.validStartAt)
      : undefined,
    validEndAt: values.validEndAt ? new Date(values.validEndAt) : undefined,
    validDays: values.validDays ? Number(values.validDays) : undefined,
  };

  if (payload.couponCode === '') {
    payload.couponCode = undefined;
  }

  if (payload.discountType !== DISCOUNT_TYPE.PERCENTAGE) {
    payload.maxDiscount = undefined;
  }

  if (payload.validType === VALID_TYPE.DAYS_AFTER_RECEIVE) {
    payload.validStartAt = undefined;
    payload.validEndAt = undefined;
  }

  return payload;
};

const transformPayloadToForm = (
  payload: Coupon,
): Partial<CreateCouponSchemaFormInput> => {
  return {
    ...payload,
    discountValue: Number(payload.discountValue),
    minPurchase: Number(payload.minPurchase),
    totalQuantity: Number(payload.totalQuantity),
    perUserLimit: Number(payload.perUserLimit),
    couponType: Number(payload.couponType),
    couponCode: payload.couponCode || '',
    discountType: Number(payload.discountType),
    maxDiscount: payload.maxDiscount ? Number(payload.maxDiscount) : undefined,
    issueType: Number(payload.issueType),
    validType: Number(payload.validType),
    validEndAt: payload.validEndAt ? new Date(payload.validEndAt) : undefined,
    validStartAt: payload.validStartAt
      ? new Date(payload.validStartAt)
      : undefined,
    validDays: payload.validDays ? Number(payload.validDays) : undefined,
  };
};

export const CouponModal: React.FC<CouponFormModalProps> = ({
  close,
  confirm,
  editingData,
  t,
}) => {
  const isEditMode = !!editingData;

  const isCriticalDisabled = !!editingData?.issuedQuantity;

  const couponSchema = useMemo(() => createCouponSchema(t), [t]);

  const form = useForm<CreateCouponSchemaFormInput>({
    resolver: zodResolver(couponSchema),
    defaultValues: {
      couponName: '',
      couponCode: '',
      issueType: 1,
      couponType: 1,
      discountType: 1,
      discountValue: 0,
      minPurchase: 0,
      maxDiscount: undefined,
      totalQuantity: 0,
      perUserLimit: 1,
      validType: 1,
      validDays: 7,
      validStartAt: undefined,
      validEndAt: undefined,
      subTitle: '',
      description: '',
    },
  });

  useEffect(() => {
    if (!editingData) return;
    const formData = transformPayloadToForm(editingData);
    form.reset(formData);
  }, [editingData, form]);

  // Core change: Unified handling of submit logic
  const { run, loading } = useRequest(
    async (values: CreateCouponSchemaFormInput) => {
      const data: CreateCouponPayload = transformFormToPayload(values);

      if (isEditMode && editingData) {
        // CRITICAL FIX: Strip sensitive fields if the coupon is already issued
        // This prevents the backend's strict inequality check (e.g. 30 !== "30.00") from triggering a 400 error.
        if ((editingData?.issuedQuantity ?? 0) > 0) {
          const d = data as unknown as Record<string, unknown>;
          delete d.couponType;
          delete d.discountType;
          delete d.discountValue;
          delete d.minPurchase;
          delete d.maxDiscount;
          delete d.validType;
          delete d.validDays;
          delete d.validStartAt;
          delete d.validEndAt;
          delete d.issueType;
        }

        // Update API
        return couponApi.update(editingData.id, data);
      } else {
        // Create API
        return couponApi.create(data);
      }
    },
    {
      manual: true,
      onSuccess: () => {
        // Close modal and refresh table list upon success
        confirm();
      },
    },
  );

  const discountType = form.watch('discountType');
  const validType = form.watch('validType');

  const discountTypeNum = Number(discountType || DISCOUNT_TYPE.FIXED_AMOUNT);
  const validTypeNum = Number(validType || VALID_TYPE.RANGE);

  const onSubmit = (values: CreateCouponSchemaFormInput) => {
    run(values);
  };

  return (
    <div className="space-y-6">
      {/* Add a title to distinguish the mode */}
      <div className="text-lg font-semibold">
        {isEditMode ? t('coupon.editCoupon') : t('coupon.createCoupon')}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormTextField
              required
              name="couponName"
              label={t('coupon.couponName')}
              placeholder={t('coupon.couponNamePlaceholder')}
            />

            {/* Coupon Code is usually not recommended to change after creation, assuming it can be changed here */}
            <FormTextField
              disabled={!!editingData?.couponCode}
              name="couponCode"
              label={t('coupon.couponCode')}
              placeholder={t('coupon.couponCodePlaceholder')}
            />

            <FormSelectField
              required
              label={t('coupon.issueType')}
              name="issueType"
              // Assuming IssueType is a critical field, cannot be changed
              disabled={isCriticalDisabled}
              options={ISSUE_TYPE_OPTIONS.map((option) => {
                const labelKey =
                  option.value === ISSUE_TYPE.SYSTEM
                    ? 'coupon.optionIssueTypeSystem'
                    : option.value === ISSUE_TYPE.CLAIM
                      ? 'coupon.optionIssueTypeClaim'
                      : option.value === ISSUE_TYPE.REDEEM_CODE
                        ? 'coupon.optionIssueTypeRedeemCode'
                        : 'coupon.optionIssueTypeInvite';
                return {
                  label: t(labelKey),
                  value: option.value.toString(),
                };
              })}
            />

            {/*  Critical fields lock start */}
            <FormSelectField
              required
              label={t('coupon.couponType')}
              name="couponType"
              disabled={isCriticalDisabled}
              options={COUPON_TYPE_OPTIONS.map((option) => {
                const labelKey =
                  option.value === COUPON_TYPE.FULL_REDUCTION
                    ? 'coupon.optionCouponTypeFullReduction'
                    : option.value === COUPON_TYPE.DISCOUNT
                      ? 'coupon.optionCouponTypeDiscount'
                      : 'coupon.optionCouponTypeNoThreshold';
                return {
                  label: t(labelKey),
                  value: option.value.toString(),
                };
              })}
            />

            <FormSelectField
              required
              label={t('coupon.discountType')}
              name="discountType"
              disabled={isCriticalDisabled}
              options={DISCOUNT_TYPE_OPTIONS.map((option) => {
                const labelKey =
                  option.value === DISCOUNT_TYPE.FIXED_AMOUNT
                    ? 'coupon.optionDiscountTypeFixedAmount'
                    : 'coupon.optionDiscountTypePercentage';
                return {
                  label: t(labelKey),
                  value: option.value.toString(),
                };
              })}
            />

            <FormTextField
              required
              name="discountValue"
              type="number"
              disabled={isCriticalDisabled}
              label={
                discountTypeNum === DISCOUNT_TYPE.PERCENTAGE
                  ? t('coupon.discountPercent')
                  : t('coupon.discountAmount')
              }
            />

            <FormTextField
              required
              label={t('coupon.minPurchase')}
              name="minPurchase"
              type="number"
              disabled={isCriticalDisabled}
            />

            {discountTypeNum === DISCOUNT_TYPE.PERCENTAGE && (
              <FormTextField
                required
                label={t('coupon.maxDiscount')}
                type="number"
                name="maxDiscount"
                // Max discount is usually critical amount info too
                disabled={isCriticalDisabled}
              />
            )}

            {/* Total Quantity can usually increase, but not decrease. Allowed to edit for now. */}
            <FormTextField
              required
              label={t('coupon.totalQuantity')}
              type="number"
              name="totalQuantity"
            />

            <FormTextField
              required
              label={t('coupon.perUserLimit')}
              type="number"
              name="perUserLimit"
            />

            {/* Valid Type is also a critical field */}
            <FormSelectField
              required
              label={t('coupon.validType')}
              name="validType"
              disabled={isCriticalDisabled}
              options={VALID_TYPE_OPTIONS.map((option) => {
                const labelKey =
                  option.value === VALID_TYPE.RANGE
                    ? 'coupon.optionValidTypeFixedDateRange'
                    : 'coupon.optionValidTypeDaysAfterReceive';
                return {
                  label: t(labelKey),
                  value: option.value.toString(),
                };
              })}
            />

            {validTypeNum === VALID_TYPE.DAYS_AFTER_RECEIVE && (
              <FormTextField
                required
                label={t('coupon.validDays')}
                type="number"
                name="validDays"
                disabled={isCriticalDisabled}
              />
            )}

            {validTypeNum === VALID_TYPE.RANGE && (
              <>
                <FormDateField
                  required
                  label={t('coupon.validStartDate')}
                  name="validStartAt"
                  // Date range is usually not heavily modified, depends on business logic
                  disabled={isCriticalDisabled}
                />
                <FormDateField
                  required
                  label={t('coupon.validEndDate')}
                  name="validEndAt"
                  disabled={isCriticalDisabled}
                />
              </>
            )}

            <div className="sm:col-span-2">
              <FormTextareaField
                name="subTitle"
                label={t('coupon.subtitle')}
                placeholder={t('coupon.subtitlePlaceholder')}
              />
            </div>

            <div className="sm:col-span-2">
              <FormTextareaField
                name="description"
                label={t('coupon.description')}
                placeholder={t('coupon.descriptionPlaceholder')}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-6">
            <Button type="button" variant="ghost" onClick={close}>
              {t('coupon.cancel')}
            </Button>
            <Button isLoading={loading} type="submit" variant="primary">
              {isEditMode ? t('coupon.saveChanges') : t('coupon.createCoupon')}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};
