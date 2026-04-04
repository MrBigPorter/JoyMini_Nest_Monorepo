'use client';

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRequest } from 'ahooks';
import {
  CreateCouponSchema,
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
  DISCOUNT_TYPE_OPTIONS,
  ISSUE_TYPE_OPTIONS,
  VALID_TYPE_OPTIONS,
  COUPON_TYPE_OPTIONS,
  DISCOUNT_TYPE,
  VALID_TYPE,
} from '@lucky/shared';
import { couponApi } from '@/api';
import { Coupon, CreateCouponPayload } from '@/type/types'; // Assuming your full Coupon type is here

interface CouponFormModalProps {
  close: () => void;
  confirm: () => void;
  editingData?: Coupon;
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
    couponCode: payload.couponCode || undefined,
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
}) => {
  const isEditMode = !!editingData;

  const isCriticalDisabled = !!editingData?.issuedQuantity;

  const form = useForm<CreateCouponSchemaFormInput>({
    resolver: zodResolver(CreateCouponSchema),
    defaultValues: {
      couponName: '',
      couponCode: undefined,
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
        {isEditMode ? 'Edit Coupon' : 'Create Coupon'}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormTextField
              required
              name="couponName"
              label="Coupon name"
              placeholder="e.g. New user ₱100-₱10"
            />

            {/* Coupon Code is usually not recommended to change after creation, assuming it can be changed here */}
            <FormTextField
              disabled={!!editingData?.couponCode}
              name="couponCode"
              label="Coupon code (optional)"
              placeholder="VIP666"
            />

            <FormSelectField
              required
              label="Issue type"
              name="issueType"
              // Assuming IssueType is a critical field, cannot be changed
              disabled={isCriticalDisabled}
              options={ISSUE_TYPE_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value.toString(),
              }))}
            />

            {/*  Critical fields lock start */}
            <FormSelectField
              required
              label="Coupon type"
              name="couponType"
              disabled={isCriticalDisabled}
              options={COUPON_TYPE_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value.toString(),
              }))}
            />

            <FormSelectField
              required
              label="Discount type"
              name="discountType"
              disabled={isCriticalDisabled}
              options={DISCOUNT_TYPE_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value.toString(),
              }))}
            />

            <FormTextField
              required
              name="discountValue"
              type="number"
              disabled={isCriticalDisabled}
              label={
                discountTypeNum === DISCOUNT_TYPE.PERCENTAGE
                  ? 'Discount (%)'
                  : 'Discount amount (₱)'
              }
            />

            <FormTextField
              required
              label="Min. purchase (₱)"
              name="minPurchase"
              type="number"
              disabled={isCriticalDisabled}
            />

            {discountTypeNum === DISCOUNT_TYPE.PERCENTAGE && (
              <FormTextField
                required
                label="Max discount (₱)"
                type="number"
                name="maxDiscount"
                // Max discount is usually critical amount info too
                disabled={isCriticalDisabled}
              />
            )}

            {/* Total Quantity can usually increase, but not decrease. Allowed to edit for now. */}
            <FormTextField
              required
              label="Total quantity (-1 = unlimited)"
              type="number"
              name="totalQuantity"
            />

            <FormTextField
              required
              label="Per user limit"
              type="number"
              name="perUserLimit"
            />

            {/* Valid Type is also a critical field */}
            <FormSelectField
              required
              label="Valid type"
              name="validType"
              disabled={isCriticalDisabled}
              options={VALID_TYPE_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value.toString(),
              }))}
            />

            {validTypeNum === VALID_TYPE.DAYS_AFTER_RECEIVE && (
              <FormTextField
                required
                label="Valid days after claim"
                type="number"
                name="validDays"
                disabled={isCriticalDisabled}
              />
            )}

            {validTypeNum === VALID_TYPE.RANGE && (
              <>
                <FormDateField
                  required
                  label="Valid start date"
                  name="validStartAt"
                  // Date range is usually not heavily modified, depends on business logic
                  disabled={isCriticalDisabled}
                />
                <FormDateField
                  required
                  label="Valid end date"
                  name="validEndAt"
                  disabled={isCriticalDisabled}
                />
              </>
            )}

            <div className="sm:col-span-2">
              <FormTextareaField
                name="subTitle"
                label="Subtitle (optional)"
                placeholder="e.g. Valid on orders over ₱100"
              />
            </div>

            <div className="sm:col-span-2">
              <FormTextareaField
                name="description"
                label="Description (optional)"
                placeholder="e.g. This is a coupon for new users only"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-6">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button isLoading={loading} type="submit" variant="primary">
              {isEditMode ? 'Save changes' : 'Create coupon'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};
