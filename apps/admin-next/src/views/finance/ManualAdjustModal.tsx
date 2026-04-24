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
import { useTranslation } from '@/hooks/useTranslation';

// Zod Schema 定义
const getAdjustSchema = (t: (key: string) => string) =>
  z.object({
    userId: z.string().min(1, t('finance.manualAdjust.validationUserId')),
    actionType: z.coerce.number(), // 1: Income, 2: Outcome
    balanceType: z.coerce.number(), // 1: Cash, 2: Coin
    amount: z.coerce
      .number()
      .positive(t('finance.manualAdjust.validationAmountPositive'))
      .refine(
        (val) => /^\d+(\.\d{1,2})?$/.test(String(val)),
        t('finance.manualAdjust.validationAmountDecimal'),
      ),
    remark: z.string().min(1, t('finance.manualAdjust.validationRemark')),
  });

type AdjustFormInput = z.infer<ReturnType<typeof getAdjustSchema>>;

interface Props {
  close: () => void;
  confirm: () => void;
}

export const ManualAdjustModal: React.FC<Props> = ({ close, confirm }) => {
  const { t } = useTranslation();
  const AdjustSchema = getAdjustSchema(t);
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
        ⚠️ <strong>{t('finance.manualAdjust.warning')}</strong>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormTextField
            name="userId"
            label={t('finance.manualAdjust.targetUserId')}
            placeholder={t('finance.manualAdjust.userIdPlaceholder')}
          />

          <div className="grid grid-cols-2 gap-4">
            <FormSelectField
              name="actionType"
              label={t('finance.manualAdjust.action')}
              options={[
                {
                  label: t('finance.manualAdjust.increase'),
                  value: String(DIRECTION.INCOME),
                },
                {
                  label: t('finance.manualAdjust.deduct'),
                  value: String(DIRECTION.EXPENDITURE),
                },
              ]}
            />
            <FormSelectField
              name="balanceType"
              label={t('finance.manualAdjust.assetType')}
              options={[
                {
                  label: t('finance.manualAdjust.cashBalance'),
                  value: String(BALANCE_TYPE.CASH),
                },
                {
                  label: t('finance.manualAdjust.coins'),
                  value: String(BALANCE_TYPE.COIN),
                },
              ]}
            />
          </div>

          <FormTextField
            name="amount"
            label={t('finance.manualAdjust.amount')}
            type="number"
            placeholder={t('finance.manualAdjust.amountPlaceholder')}
          />

          <FormTextareaField
            name="remark"
            label={t('finance.manualAdjust.reason')}
            placeholder={t('finance.manualAdjust.reasonPlaceholder')}
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="ghost" onClick={close}>
              {t('finance.manualAdjust.cancel')}
            </Button>
            <Button isLoading={loading} type="submit" variant="primary">
              {t('finance.manualAdjust.confirmAdjustment')}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};
