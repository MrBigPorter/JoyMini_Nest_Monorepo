'use client';

import React, { useEffect, useMemo } from 'react';
import Image from 'next/image';
import { useRequest } from 'ahooks';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Save,
  CreditCard,
  Smartphone,
  AlertCircle,
  Banknote,
  Settings2,
  ArrowRightLeft,
} from 'lucide-react';
import {
  Button,
  cn,
  Form,
  FormCheckboxField,
  FormSelectField,
  FormTextField,
} from '@repo/ui';
import { useToastStore } from '@/store/useToastStore';
import { CreatePaymentChannelPayload, PaymentChannel } from '@/type/types';
import { paymentChannelApi } from '@/api';

// --- 1. Zod Schema 定义 ---
const PaymentChannelSchema = z.object({
  code: z.string().min(1, 'Channel Code is required'),
  name: z.string().min(1, 'Display Name is required'),
  icon: z.string().url('Must be a valid URL').or(z.literal('')),
  type: z.number(), // 1=Recharge, 2=Withdraw
  status: z.number(), // 0=Disabled, 1=Active, 2=Maintenance
  sortOrder: z.coerce.number(),

  // Limits
  minAmount: z.coerce.number().min(0),
  maxAmount: z.coerce.number().min(0),
  isCustom: z.boolean(),

  // Fee (Withdraw)
  feeFixed: z.coerce.number(),
  feeRate: z.coerce.number().min(0).max(1),

  // UI Helper for Fixed Amounts (Recharge)
  // 这个字段只存在于表单中，提交时会被转换
  fixedAmountStr: z.string().optional(),
});

// 表单输入的类型
type PaymentChannelFormInputs = z.infer<typeof PaymentChannelSchema>;

// Xendit 常用 Code
const PRESET_CODES = [
  { value: 'PH_GCASH', label: 'GCash (Money In)', type: 1 },
  { value: 'PH_PAYMAYA', label: 'Maya (Money In)', type: 1 },
  { value: 'PH_GRABPAY', label: 'GrabPay', type: 1 },
  { value: 'PH_7ELEVEN', label: '7-Eleven', type: 1 },
  { value: 'PH_GCASH_OUT', label: 'GCash (Money Out)', type: 2 },
  { value: 'PH_BDO_OUT', label: 'BDO Unibank', type: 2 },
  { value: 'PH_BPI_OUT', label: 'BPI', type: 2 },
];

interface Props {
  data?: PaymentChannel;
  close: () => void;
  reload: () => void;
}

// 辅助函数：解析金额字符串
const parseFixedAmounts = (str?: string): number[] => {
  if (!str) return [];
  return str
    .split(/[,，\s]+/)
    .map((s) => Number(s))
    .filter((n) => !isNaN(n) && n > 0);
};

// --- 组件：模拟手机预览 ---
const MobilePreview = ({
  values,
}: {
  values: Partial<PaymentChannelFormInputs>;
}) => {
  const fixedAmounts = useMemo(
    () => parseFixedAmounts(values.fixedAmountStr),
    [values.fixedAmountStr],
  );

  return (
    <div className="w-[300px] h-[600px] bg-black rounded-[40px] p-3 shadow-2xl border-4 border-gray-800 relative mx-auto mt-4">
      {/* 模拟刘海 */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-black rounded-b-xl z-20"></div>

      {/* 屏幕内容 */}
      <div className="w-full h-full bg-gray-50 dark:bg-gray-900 rounded-[30px] overflow-hidden flex flex-col relative">
        {/* Header */}
        <div className="bg-primary-600 h-32 p-4 pt-10 text-white flex flex-col justify-between">
          <div className="text-xs opacity-80">Cashier Preview</div>
          <div className="font-bold text-xl">Deposit</div>
        </div>

        {/* 渠道卡片 */}
        <div className="p-4 -mt-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {values.icon ? (
                <Image
                  src={values.icon}
                  alt="Channel icon"
                  width={40}
                  height={40}
                  className="w-10 h-10 object-contain"
                  unoptimized
                />
              ) : (
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                  <CreditCard size={20} className="text-gray-400" />
                </div>
              )}
              <div>
                <div className="font-bold text-sm text-gray-900 dark:text-white">
                  {values.name || 'Channel Name'}
                </div>
                <div className="text-[10px] text-gray-500">
                  {values.type === 1 ? 'Instant Deposit' : 'Bank Transfer'}
                </div>
              </div>
            </div>
            <div className="w-4 h-4 rounded-full border-2 border-primary-500 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-primary-500" />
            </div>
          </div>

          {/* 金额网格 (仅充值显示) */}
          {values.type === 1 && (
            <div className="mt-4">
              <div className="text-xs text-gray-500 mb-2 font-medium">
                Select Amount
              </div>
              <div className="grid grid-cols-3 gap-2">
                {fixedAmounts.map((amt, idx) => (
                  <div
                    key={idx}
                    className="bg-white dark:bg-gray-800 border border-primary-500 rounded-lg py-2 text-center shadow-sm"
                  >
                    <span className="text-xs font-bold text-primary-600">
                      ₱{amt}
                    </span>
                  </div>
                ))}
                {fixedAmounts.length === 0 && (
                  <div className="col-span-3 text-center py-4 text-xs text-gray-400 border border-dashed rounded">
                    No fixed amounts
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 输入框 */}
          {values.isCustom && (
            <div className="mt-4 p-3 bg-white dark:bg-gray-800 border border-gray-200 rounded-lg flex justify-between items-center">
              <span className="text-xs text-gray-400">Enter amount...</span>
              <span className="text-xs font-mono text-gray-900">₱0.00</span>
            </div>
          )}

          {/* 提现费率提示 */}
          {values.type === 2 && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-amber-700 text-xs">
              <div>
                Fee: ₱{values.feeFixed || 0} + {(values.feeRate || 0) * 100}%
              </div>
              <div className="mt-1 opacity-70">Min: ₱{values.minAmount}</div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="mt-auto p-4">
          <div className="w-full bg-primary-600 text-white text-center py-3 rounded-full text-sm font-bold shadow-lg shadow-primary-500/30">
            Confirm
          </div>
        </div>
      </div>
    </div>
  );
};

// --- 组件：表单区块标题 ---
// Fix: 替换 any 为 React.ElementType 或 LucideIcon
const SectionTitle = ({
  icon: Icon,
  title,
}: {
  icon: React.ElementType;
  title: string;
}) => (
  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-100 dark:border-white/5 mt-6 first:mt-0">
    <Icon size={16} className="text-primary-600" />
    <h3 className="font-bold text-gray-800 dark:text-white text-sm">{title}</h3>
  </div>
);

export const PaymentChannelModal: React.FC<Props> = ({
  data,
  close,
  reload,
}) => {
  const addToast = useToastStore((state) => state.addToast);

  // 1. 初始化 Form
  const form = useForm<PaymentChannelFormInputs>({
    resolver: zodResolver(PaymentChannelSchema),
    defaultValues: {
      code: '',
      name: '',
      icon: '',
      type: 1,
      status: 1,
      minAmount: 100,
      maxAmount: 50000,
      fixedAmountStr: '100, 200, 500, 1000, 2000, 5000',
      feeFixed: 0,
      feeRate: 0,
      isCustom: true,
      sortOrder: 0,
    },
  });

  // 2. 监听表单值
  const watchedValues = useWatch({ control: form.control });

  // 3. 填充编辑数据
  useEffect(() => {
    if (data) {
      form.reset({
        code: data.code,
        name: data.name,
        icon: data.icon || '',
        type: data.type,
        status: data.status,
        minAmount: data.minAmount,
        maxAmount: data.maxAmount,
        fixedAmountStr: data.fixedAmounts?.join(', ') || '',
        feeFixed: data.feeFixed,
        feeRate: data.feeRate,
        isCustom: data.isCustom,
        sortOrder: data.sortOrder,
      });
    }
  }, [data, form]);

  // 4. API 请求处理
  const { run: handleSubmit, loading } = useRequest(
    async (values: PaymentChannelFormInputs) => {
      // Fix: 通过解构赋值移除 fixedAmountStr，而不是 delete + as any
      const { fixedAmountStr, ...rest } = values;

      // 构造类型安全的 Payload
      const payload: CreatePaymentChannelPayload = {
        ...rest,
        // 将字符串转换为数字数组
        fixedAmounts: parseFixedAmounts(fixedAmountStr),
      };

      if (data?.id) {
        return paymentChannelApi.update(data.id, payload);
      } else {
        return paymentChannelApi.create(payload);
      }
    },
    {
      manual: true,
      onSuccess: () => {
        addToast(
          'success',
          `Channel ${data ? 'updated' : 'created'} successfully`,
        );
        reload();
        close();
      },
      onError: (err) => addToast('error', err.message),
    },
  );

  return (
    <div className="flex flex-col lg:flex-row h-full w-full overflow-hidden bg-white dark:bg-gray-900">
      {/* --- LEFT: Live Preview --- */}
      <div className="flex-1 overflow-y-auto p-8 bg-gray-100 dark:bg-black/20 custom-scrollbar border-r border-gray-200 dark:border-white/5 flex flex-col items-center justify-center">
        <div className="text-center mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center justify-center gap-2">
            <Smartphone size={20} /> Mobile Preview
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Real-time preview of user interface
          </p>
        </div>
        <MobilePreview values={watchedValues} />
      </div>

      {/* --- RIGHT: Configuration Form --- */}
      <div className="w-full lg:w-[500px] flex flex-col h-full bg-white dark:bg-gray-900 shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)] z-10 relative">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="flex flex-col h-full"
          >
            {/* Scrollable Form Body */}
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {/* 1. Basic Info */}
              <SectionTitle icon={CreditCard} title="Basic Information" />
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Business Type
                    </label>
                    <div className="flex bg-gray-100 dark:bg-white/5 p-1 rounded-lg">
                      <button
                        type="button"
                        onClick={() => form.setValue('type', 1)}
                        className={cn(
                          'flex-1 py-1.5 text-xs font-medium rounded-md transition-all',
                          watchedValues.type === 1
                            ? 'bg-white shadow text-primary-600'
                            : 'text-gray-500 hover:text-gray-700',
                        )}
                      >
                        Money In
                      </button>
                      <button
                        type="button"
                        onClick={() => form.setValue('type', 2)}
                        className={cn(
                          'flex-1 py-1.5 text-xs font-medium rounded-md transition-all',
                          watchedValues.type === 2
                            ? 'bg-white shadow text-amber-600'
                            : 'text-gray-500 hover:text-gray-700',
                        )}
                      >
                        Money Out
                      </button>
                    </div>
                  </div>
                  <div>
                    <FormSelectField
                      name="status"
                      label="Status"
                      numeric={true}
                      options={[
                        { label: 'Active', value: '1' },
                        { label: 'Disabled', value: '0' },
                        { label: 'Maintenance', value: '2' },
                      ]}
                    />
                  </div>
                </div>

                {/* Channel Code */}
                <div>
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                    Channel Code (Xendit)
                  </label>
                  <div className="relative">
                    <input
                      list="xendit_codes"
                      {...form.register('code')}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="e.g. PH_GCASH"
                    />
                    <datalist id="xendit_codes">
                      {PRESET_CODES.filter(
                        (c) => !c.type || c.type === watchedValues.type,
                      ).map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </datalist>
                    {form.formState.errors.code && (
                      <p className="text-[0.8rem] font-medium text-destructive mt-1">
                        {form.formState.errors.code.message}
                      </p>
                    )}
                  </div>
                </div>

                <FormTextField
                  name="name"
                  label="Display Name"
                  placeholder="e.g. GCash"
                />

                <div className="flex gap-2 items-start">
                  <div className="flex-1">
                    <FormTextField
                      name="icon"
                      label="Icon URL"
                      placeholder="https://..."
                    />
                  </div>
                  {watchedValues.icon && (
                    <div className="mt-6 w-9 h-9 border rounded flex items-center justify-center shrink-0 bg-gray-50">
                      <Image
                        src={watchedValues.icon}
                        alt="Channel icon"
                        width={24}
                        height={24}
                        className="w-6 h-6 object-contain"
                        unoptimized
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormTextField
                    name="sortOrder"
                    label="Sort Order"
                    type="number"
                  />
                </div>
              </div>

              {/* 2. Limits & Control */}
              <SectionTitle icon={Settings2} title="Limits & Control" />
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormTextField
                    name="minAmount"
                    label="Min Amount"
                    type="number"
                  />
                  <FormTextField
                    name="maxAmount"
                    label="Max Amount"
                    type="number"
                  />
                </div>

                <div className="flex items-center justify-between p-3 border rounded-lg bg-gray-50 dark:bg-white/5 dark:border-white/10">
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      Allow Custom Input
                    </div>
                    <div className="text-xs text-gray-500">
                      Users can enter any amount within range
                    </div>
                  </div>
                  <FormCheckboxField name="isCustom" label="" />
                </div>
              </div>

              {/* 3. Type Specific (Dynamic) */}
              {watchedValues.type === 1 ? (
                <>
                  <SectionTitle icon={Banknote} title="Recharge Settings" />
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block">
                      Fixed Amounts
                      <span className="ml-2 text-[10px] text-primary-600 bg-primary-50 px-1 rounded">
                        Comma separated
                      </span>
                    </label>
                    <textarea
                      {...form.register('fixedAmountStr')}
                      className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="e.g. 100, 200, 500, 1000"
                    />
                    {/* Helper tags - 使用 useMemo 避免不必要的渲染 */}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {parseFixedAmounts(watchedValues.fixedAmountStr).map(
                        (amt, i) => (
                          <span
                            key={i}
                            className="text-[10px] px-2 py-1 bg-gray-100 rounded text-gray-600 border dark:bg-white/10 dark:text-gray-300"
                          >
                            ₱{amt}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <SectionTitle icon={ArrowRightLeft} title="Withdrawal Fees" />
                  <div className="grid grid-cols-2 gap-4">
                    <FormTextField
                      name="feeFixed"
                      label="Fixed Fee (₱)"
                      type="number"
                    />
                    <div className="relative">
                      <FormTextField
                        name="feeRate"
                        label="Fee Rate (0-1)"
                        type="number"
                      />
                      <span className="absolute right-3 top-8 text-gray-400 text-xs">
                        {((Number(watchedValues.feeRate) || 0) * 100).toFixed(
                          1,
                        )}
                        %
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-gray-400 flex items-center gap-1">
                    <AlertCircle size={10} /> Total Fee = Fixed Fee + (Amount *
                    Rate)
                  </div>
                </>
              )}
            </div>

            {/* Sticky Footer */}
            <div className="flex-none p-5 border-t border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-gray-800/50 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={close}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={loading}>
                <Save size={16} className="mr-2" /> Save Configuration
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
};
