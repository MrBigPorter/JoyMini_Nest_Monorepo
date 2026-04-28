'use client';

import React, { useEffect, useCallback } from 'react';
import { Modal, Button } from '@/components/UIComponents';
import { Form, FormTextField, FormTextareaField } from '@repo/ui/form';
import { useBlogForm } from '@/hooks/useBlogForm';
import { tagSchema, type TagFormInputs } from '@/schema/blog';
import { blogApi } from '@/api';
import { useRequest } from 'ahooks';
import { useLanguage } from '@/hooks/LanguageProvider';
import { useLocalizedFormV2 } from '@/hooks/useLocalizedFormV2';
import { LanguageSwitch } from '@/components/blog/LanguageSwitch';
import {
  extractCurrentLocaleValue,
  normalizeLocalizedValue,
} from '@/utils/localizedForm';
import { useTranslation } from '@/hooks/useTranslation';

interface BlogTagModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  editingTag?: {
    id: string;
    name: Record<string, string | undefined>;
    slug: string;
    color?: string;
    description?: Record<string, string | undefined>;
  } | null;
  onSuccessAction: () => void;
}

export const BlogTagModal: React.FC<BlogTagModalProps> = ({
  isOpen,
  onCloseAction,
  editingTag,
  onSuccessAction,
}) => {
  const isEditing = !!editingTag;
  const { t } = useTranslation();

  const { run: createTag, loading: isCreating } = useRequest(
    blogApi.createTag,
    {
      manual: true,
      onSuccess: () => {
        onSuccessAction();
        onCloseAction();
      },
    },
  );

  const { run: updateTag, loading: isUpdating } = useRequest(
    blogApi.updateTag,
    {
      manual: true,
      onSuccess: () => {
        onSuccessAction();
        onCloseAction();
      },
    },
  );

  const { locale } = useLanguage();

  const getDefaultValues = useCallback(() => {
    if (!editingTag) {
      return {
        name: '',
        slug: '',
        color: '#3b82f6',
        description: '',
      };
    }

    // 确保返回的值100%是字符串，而不是对象
    const safeName = extractCurrentLocaleValue(editingTag.name, locale);
    const safeDescription = extractCurrentLocaleValue(
      editingTag.description,
      locale,
    );

    // 额外的防御性检查：如果 extractCurrentLocaleValue 返回对象，强制转换为字符串
    const finalName =
      typeof safeName === 'string' ? safeName : String(safeName || '');
    const finalDescription =
      typeof safeDescription === 'string'
        ? safeDescription
        : String(safeDescription || '');

    return {
      ...editingTag,
      name: finalName,
      description: finalDescription,
      slug: editingTag.slug || '',
      color: editingTag.color || '#3b82f6',
    };
  }, [editingTag, locale]);

  const blogForm = useBlogForm({
    schema: tagSchema,
    defaultValues: undefined, // Don't pass default values here, let useEffect handle it
    onSubmitAction: async (data: TagFormInputs) => {
      if (isEditing && editingTag) {
        await updateTag(editingTag.id, data);
      } else {
        await createTag(data);
      }
    },
  });

  const { form, submitHandler, isLoading } = blogForm;
  const { register, reset, getValues } = form;
  const { localize } = useLocalizedFormV2({
    watch: form.watch,
    setValue: form.setValue,
    getValues: form.getValues,
    locale,
    availableLocales: ['zh', 'en'],
  });

  useEffect(() => {
    if (isOpen) {
      const defaultValues = getDefaultValues();
      // 类型断言：我们的值符合 TagFormInputs 类型
      form.reset(defaultValues as any);
    } else {
      // 弹窗关闭时完全重置表单 - 使用字符串而不是对象，避免类型错误
      const resetValues = {
        name: '',
        slug: '',
        color: '#3b82f6',
        description: '',
      };
      form.reset(resetValues as any);
      // useLocalizedFormV2 不需要清理函数，它会自动管理状态
    }
  }, [isOpen, form, editingTag, getDefaultValues]);

  const loading = isCreating || isUpdating || isLoading;

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={isEditing ? t('tags_modalTitleEdit') : t('tags_modalTitleCreate')}
      size="md"
    >
      <Form {...form}>
        <form onSubmit={submitHandler} className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium">{t('tags_name')}</h3>
            <LanguageSwitch />
          </div>
          <FormTextField
            label=""
            placeholder={t('tags_namePlaceholder')}
            required
            {...localize('name')}
          />
          <FormTextField
            label={t('tags_slug')}
            placeholder={t('tags_slugPlaceholder')}
            required
            {...register('slug', { required: true })}
          />
          <FormTextField
            label={t('tags_color')}
            placeholder={t('tags_colorPlaceholder')}
            {...register('color')}
          />
          <FormTextareaField
            label={t('tags_description')}
            placeholder={t('tags_descriptionPlaceholder')}
            {...localize('description')}
          />
          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onCloseAction}
              disabled={loading}
            >
              {t('tags_cancel')}
            </Button>
            <Button type="submit" isLoading={loading}>
              {isEditing ? t('tags_update') : t('tags_create')}
            </Button>
          </div>
        </form>
      </Form>
    </Modal>
  );
};
