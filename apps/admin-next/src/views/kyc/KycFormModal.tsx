'use client';

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRequest } from 'ahooks';
import {
  Button,
  Form,
  FormTextField,
  FormTextareaField,
  FormSelectField,
} from '@repo/ui';
import { kycApi } from '@/api';
import { useToastStore } from '@/store/useToastStore';
import { KycRecord } from '@/type/types';
import { KycIdTypesList, KycIdCardType } from '@lucky/shared';
import type { TFunc } from '@/hooks/useTranslation';

// 1. 定义 Schema (function factory to support i18n error messages)
const createKycFormSchema = (t: (key: string) => string) =>
  z.object({
    userId: z.string().min(1, t('kyc_validation_userIdRequired')),
    realName: z.string().min(1, t('kyc_validation_realNameRequired')),
    idNumber: z.string().min(1, t('kyc_validation_idNumberRequired')),
    idType: z.coerce.number(),
    remark: z.string().optional(),
  });

type KycFormInput = z.infer<ReturnType<typeof createKycFormSchema>>;

interface Props {
  mode: 'create' | 'edit';
  initialData?: KycRecord; // 编辑模式下的回显数据
  closeAction: () => void;
  reloadAction: () => void;
  tAction: TFunc;
}

export const KycFormModal: React.FC<Props> = ({
  mode,
  initialData,
  closeAction,
  reloadAction,
  tAction,
}) => {
  const addToast = useToastStore((state) => state.addToast);
  const isEdit = mode === 'edit';

  // 2. 初始化 Form
  const form = useForm<KycFormInput>({
    resolver: zodResolver(createKycFormSchema(tAction)),
    defaultValues: {
      userId: '',
      realName: '',
      idNumber: '',
      idType: 1,
      remark: '',
    },
  });

  // 3. 回显数据 (Effect)
  useEffect(() => {
    if (isEdit && initialData) {
      // 使用 reset 来设置初始值，这比逐个 setValue 更干净
      form.reset({
        userId: initialData.userId,
        realName: initialData.realName || '',
        idNumber: initialData.idNumber || '',
        idType: initialData.idType || 1,
        remark: '', // 修改时备注通常置空，让管理员填新的原因
      });
    }
  }, [isEdit, initialData, form]);

  // 4. 提交逻辑
  const { run: submit, loading } = useRequest(
    async (formData: KycFormInput) => {
      if (isEdit) {
        // [改] Update Logic
        // 注意：AdminUpdateKycParams 不需要传 userId (在 url path 里传)
        return kycApi.updateInfo(formData.userId, {
          realName: formData.realName,
          idNumber: formData.idNumber,
          idType: formData.idType,
          remark: formData.remark,
        });
      } else {
        // [增] Create Logic
        return kycApi.create({
          userId: formData.userId,
          realName: formData.realName,
          idNumber: formData.idNumber,
          idType: formData.idType,
          remark: formData.remark,
        });
      }
    },
    {
      manual: true,
      onSuccess: () => {
        addToast(
          'success',
          isEdit
            ? tAction('kyc_updatedSuccess')
            : tAction('kyc_createdSuccess'),
        );
        reloadAction();
        closeAction();
      },
      onError: (err) => {
        addToast('error', err.message || tAction('kyc_operationFailed'));
      },
    },
  );

  return (
    <div className="w-full h-full  flex flex-col">
      {/* Form Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(submit)}
            className="space-y-5 max-w-2xl mx-auto"
          >
            {/* User ID Section */}
            <div className="bg-blue-50/50 dark:bg-blue-900/10 p-4 rounded-lg border border-blue-100 dark:border-blue-900/20">
              <FormTextField
                name="userId"
                label={tAction('kyc_formUserId')}
                required={true}
                placeholder={tAction('kyc_formUserIdPlaceholder')}
                disabled={isEdit} // 编辑模式下禁止修改 UserID
              />
              {isEdit && (
                <p className="text-xs text-blue-600 mt-2 flex items-center gap-1">
                  ⓘ {tAction('kyc_formUserIdDisabledHint')}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <FormTextField
                name="realName"
                label={tAction('kyc_formRealName')}
                placeholder={tAction('kyc_formRealNamePlaceholder')}
              />

              <FormSelectField
                name="idType"
                label={tAction('kyc_formIdType')}
                options={KycIdTypesList.map((item) => ({
                  label: tAction(
                    `kyc_idType_${KycIdCardType[item.value]?.toLowerCase()}`,
                  ),
                  value: String(item.value),
                }))}
              />
            </div>

            <FormTextField
              name="idNumber"
              label={tAction('kyc_formIdNumber')}
              placeholder={tAction('kyc_formIdNumberPlaceholder')}
            />

            <FormTextareaField
              name="remark"
              label={tAction('kyc_formRemark')}
              placeholder={
                isEdit
                  ? tAction('kyc_formRemarkEditPlaceholder')
                  : tAction('kyc_formRemarkCreatePlaceholder')
              }
            />

            {/* Hidden Submit Button for 'Enter' key support */}
            <button type="submit" className="hidden" />
          </form>
        </Form>
      </div>

      {/* Footer Actions */}
      <div className="p-5 border-t border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-gray-800/50 flex justify-end gap-3">
        <Button variant="outline" onClick={closeAction} disabled={loading}>
          {tAction('kyc_cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={form.handleSubmit(submit)} // 显式绑定
          isLoading={loading}
          className="min-w-[120px]"
        >
          {isEdit ? tAction('kyc_saveChanges') : tAction('kyc_createRecord')}
        </Button>
      </div>
    </div>
  );
};
