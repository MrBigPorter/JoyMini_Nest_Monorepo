'use client';

import React, { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRequest } from 'ahooks';
import { bannerApi, uploadApi } from '@/api';
import {
  Button,
  Form,
  FormTextField,
  FormSelectField,
  FormDateField,
  FormMediaUploaderField,
} from '@repo/ui';
import { useToastStore } from '@/store/useToastStore';
import { JUMP_CATE } from '@lucky/shared';
import { Link } from 'lucide-react';
import { BannerFormInputs, BannerShema } from '@/schema/bannerShema';
import { BannerBindProduct } from '@/views/banner/BannerBindProduct';
import { Banner } from '@/type/types';
import { SmartImage } from '@/components/ui/SmartImage';
import type { TFunc } from '@/hooks/useTranslation';

interface Props {
  close: () => void;
  confirm: () => void;
  editingData?: Banner;
  defaultCate?: number; // 当前所在的 Tab
  t: TFunc;
}

export const BannerFormModal: React.FC<Props> = ({
  close,
  confirm,
  editingData,
  t,
}) => {
  const addToast = useToastStore((s) => s.addToast);

  const form = useForm<BannerFormInputs>({
    resolver: zodResolver(BannerShema),
    defaultValues: {
      title: '',
      bannerImgUrl: '',
      fileType: 1,
      bannerCate: 0,
      jumpCate: 0,
      sortOrder: 0,
      activityAtStart: undefined,
      activityAtEnd: undefined,
      relatedTitleId: undefined,
    },
  });

  //  监听跳转类型变化，实现联动
  const jumpCate = useWatch({ control: form.control, name: 'jumpCate' });

  const { run: submit, loading } = useRequest(
    async (values) => {
      let bannerImgUrl: string;

      if (values.bannerImgUrl instanceof File) {
        const { url } = await uploadApi.uploadMedia(values.bannerImgUrl);
        bannerImgUrl = url;
      } else {
        bannerImgUrl = values.bannerImgUrl;
      }

      const payload = {
        ...values,
        bannerImgUrl,
      };

      if (editingData) {
        return bannerApi.update(editingData.id, payload);
      }
      return bannerApi.create(payload);
    },
    {
      manual: true,
      onSuccess: () => {
        addToast(
          'success',
          editingData ? t('banners_toastUpdated') : t('banners_toastCreated'),
        );
        confirm();
      },
    },
  );

  useEffect(() => {
    if (editingData) {
      form.reset({
        ...editingData,
        activityAtStart: editingData.activityAtStart
          ? new Date(editingData.activityAtStart)
          : undefined,
        activityAtEnd: editingData.activityAtEnd
          ? new Date(editingData.activityAtEnd)
          : undefined,
        jumpCate: editingData.jumpCate,
        jumpUrl: editingData.jumpUrl || '',
        bannerImgUrl: editingData.bannerImgUrl,
        bannerCate: editingData.bannerCate,
        relatedTitleId: editingData.relatedTitleId || undefined,
      });
    }
  }, [editingData, form, form.reset]);

  return (
    <>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-5">
          {/* 1. 基础视觉区 */}
          <div className="grid grid-cols-1 gap-4">
            <FormTextField
              name="title"
              label={t('banners_formTitle')}
              placeholder={t('banners_formTitlePlaceholder')}
              required
            />
            <FormMediaUploaderField
              required
              maxFileCount={1}
              name="bannerImgUrl"
              label={t('banners_formCreativeAsset')}
              renderImage={({ src, alt, className }) => (
                <SmartImage
                  src={src}
                  alt={alt}
                  width={614}
                  height={300}
                  className={className}
                  imgClassName="w-[614px] h-[300px] rounded-md object-cover"
                  layout="constrained"
                />
              )}
            />
          </div>

          {/* 2. 位置与排期 */}
          <div className="grid grid-cols-2 gap-4">
            <FormSelectField
              name="bannerCate"
              label={t('banners_formPosition')}
              numeric={true}
              options={[
                { label: t('banners_positionHome'), value: '1' },
                { label: t('banners_positionActivity'), value: '2' },
                { label: t('banners_positionProduct'), value: '3' },
              ]}
            />
            <FormTextField
              name="sortOrder"
              label={t('banners_formSortOrder')}
              type="number"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormDateField
              name="activityAtStart"
              label={t('banners_formStartTime')}
            />
            <FormDateField
              name="activityAtEnd"
              label={t('banners_formEndTime')}
            />
          </div>

          {/* 3. 智能跳转配置区 (核心) */}
          <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/10 space-y-3">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('banners_clickAction')}
            </div>

            <FormSelectField
              name="jumpCate"
              label={t('banners_navType')}
              numeric={true}
              options={[
                {
                  label: t('banners_navNone'),
                  value: String(JUMP_CATE.NONE),
                },
                {
                  label: t('banners_navProduct'),
                  value: String(JUMP_CATE.TREASURE),
                },
                {
                  label: t('banners_navExternal'),
                  value: String(JUMP_CATE.EXTERNAL),
                },
              ]}
            />

            {/* 条件渲染：外链输入框 */}
            {Number(jumpCate) === JUMP_CATE.EXTERNAL && (
              <div className="animate-in fade-in slide-in-from-top-2">
                <FormTextField
                  name="jumpUrl"
                  label={t('banners_formTargetUrl')}
                  placeholder={t('banners_formTargetUrlPlaceholder')}
                  renderLeft={() => (
                    <Link size={16} className="mr-2 text-gray-400" />
                  )}
                />
              </div>
            )}

            {/* 条件渲染：产品选择器 */}
            {Number(jumpCate) === JUMP_CATE.TREASURE && (
              <Controller
                name="relatedTitleId"
                render={({ field, fieldState }) => (
                  <div>
                    <BannerBindProduct
                      value={field.value}
                      onChange={field.onChange}
                      t={t}
                    />
                    {fieldState.error && (
                      <div className="mt-1 text-sm text-red-500">
                        {fieldState.error.message}
                      </div>
                    )}
                  </div>
                )}
              />
            )}
          </div>

          <div className="flex justify-end items-center pt-2">
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                {t('banners_cancel')}
              </Button>
              <Button type="submit" isLoading={loading}>
                {t('banners_save')}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </>
  );
};
