'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRequest } from 'ahooks';
import {
  Button,
  Form,
  FormSelectField,
  FormTextField,
  FormTextareaField,
} from '@repo/ui';
import { financeApi } from '@/api';
import { revalidateFinanceAfterAdjust } from '@/lib/actions/finance-revalidate';
import { DIRECTION, BALANCE_TYPE } from '@lucky/shared';

// Zod Schema 定义
const AdjustSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  actionType: z.coerce.number(), // 1: Income, 2: Outcome
  balanceType: z.coerce.number(), // 1: Cash, 2: Coin
  amount: z.coerce
    .number()
    .positive('Amount must be greater than zero')
    .refine(
      (val) => /^\d+(\.\d{1,2})?$/.test(String(val)),
      'Must be a valid amount with up to 2 decimal places',
    ),
  remark: z.string().min(1, 'Remark is required for audit trail'),
});

type AdjustFormInput = z.infer<typeof AdjustSchema>;

interface Props {
  close: () => void;
  confirm: () => void;
}

export const ManualAdjustModal: React.FC<Props> = ({ close, confirm }) => {
  const form = useForm<AdjustFormInput>({
    resolver: zodResolver(AdjustSchema),
    defaultValues: {
      actionType: DIRECTION.INCOME,
      balanceType: BALANCE_TYPE.CASH,
      amount: 0,
    },
  });

  const { run, loading } = useRequest(financeApi.adjust, {
    manual: true,
    onSuccess: () => {
      void revalidateFinanceAfterAdjust();
      confirm();
    },
  });

  const onSubmit = (data: AdjustFormInput) => {
    run(data);
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 text-blue-700 p-3 rounded-md text-sm mb-4">
        ⚠️ <strong>Warning:</strong> This action involves real fund movement.
        All operations are logged.
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormTextField
            name="userId"
            label="Target User ID"
            placeholder="e.g. user_12345"
          />

          <div className="grid grid-cols-2 gap-4">
            <FormSelectField
              name="actionType"
              label="Action"
              options={[
                { label: 'Increase (+)', value: String(DIRECTION.INCOME) },
                { label: 'Deduct (-)', value: String(DIRECTION.EXPENDITURE) },
              ]}
            />
            <FormSelectField
              name="balanceType"
              label="Asset Type"
              options={[
                { label: 'Cash Balance', value: String(BALANCE_TYPE.CASH) },
                { label: 'Coins', value: String(BALANCE_TYPE.COIN) },
              ]}
            />
          </div>

          <FormTextField
            name="amount"
            label="Amount"
            type="number"
            placeholder="0.00"
          />

          <FormTextareaField
            name="remark"
            label="Reason / Remark"
            placeholder="Explain why this adjustment is made..."
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button isLoading={loading} type="submit" variant="primary">
              Confirm Adjustment
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};
