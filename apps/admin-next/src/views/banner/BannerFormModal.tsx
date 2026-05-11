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
  closeAction: () => void;
  confirmAction: () => void;
  editingData?: Banner;
  defaultCate?: number; // 当前所在的 Tab
  tAction: TFunc;
}

export const BannerFormModal: React.FC<Props> = ({
  closeAction,
  confirmAction,
  editingData,
  tAction,
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
      let bannerBlurhash: string | undefined;

      if (values.bannerImgUrl instanceof File) {
        const { url, blurhash } = await uploadApi.uploadMedia(
          values.bannerImgUrl,
        );
        bannerImgUrl = url;
        bannerBlurhash = blurhash;
      } else {
        bannerImgUrl = values.bannerImgUrl;
      }

      const payload = {
        ...values,
        bannerImgUrl,
        blurhash: bannerBlurhash,
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
          editingData
            ? tAction('banners_toastUpdated')
            : tAction('banners_toastCreated'),
        );
        confirmAction();
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
              label={tAction('banners_formTitle')}
              placeholder={tAction('banners_formTitlePlaceholder')}
              required
            />
            <FormMediaUploaderField
              required
              maxFileCount={1}
              name="bannerImgUrl"
              label={tAction('banners_formCreativeAsset')}
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
              label={tAction('banners_formPosition')}
              numeric={true}
              options={[
                { label: tAction('banners_positionHome'), value: '1' },
                { label: tAction('banners_positionActivity'), value: '2' },
                { label: tAction('banners_positionProduct'), value: '3' },
              ]}
            />
            <FormTextField
              name="sortOrder"
              label={tAction('banners_formSortOrder')}
              type="number"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormDateField
              name="activityAtStart"
              label={tAction('banners_formStartTime')}
            />
            <FormDateField
              name="activityAtEnd"
              label={tAction('banners_formEndTime')}
            />
          </div>

          {/* 3. 智能跳转配置区 (核心) */}
          <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/10 space-y-3">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {tAction('banners_clickAction')}
            </div>

            <FormSelectField
              name="jumpCate"
              label={tAction('banners_navType')}
              numeric={true}
              options={[
                {
                  label: tAction('banners_navNone'),
                  value: String(JUMP_CATE.NONE),
                },
                {
                  label: tAction('banners_navProduct'),
                  value: String(JUMP_CATE.TREASURE),
                },
                {
                  label: tAction('banners_navExternal'),
                  value: String(JUMP_CATE.EXTERNAL),
                },
              ]}
            />

            {/* 条件渲染：外链输入框 */}
            {Number(jumpCate) === JUMP_CATE.EXTERNAL && (
              <div className="animate-in fade-in slide-in-from-top-2">
                <FormTextField
                  name="jumpUrl"
                  label={tAction('banners_formTargetUrl')}
                  placeholder={tAction('banners_formTargetUrlPlaceholder')}
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
                control={form.control}
                render={({ field, fieldState }) => (
                  <div>
                    <BannerBindProduct
                      value={field.value}
                      onChange={field.onChange}
                      tAction={tAction}
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
              <Button type="button" variant="ghost" onClick={closeAction}>
                {tAction('banners_cancel')}
              </Button>
              <Button type="submit" isLoading={loading}>
                {tAction('banners_save')}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </>
  );
};
