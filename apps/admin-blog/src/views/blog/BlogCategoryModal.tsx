'use client';

import React, { useEffect, useCallback } from 'react';
import { Modal, Button } from '@/components/UIComponents';
import { Form, FormTextField, FormTextareaField } from '@repo/ui/form';
import { useBlogForm } from '@/hooks/useBlogForm';
import { categorySchema } from '@/schema/blog';
import { blogApi } from '@/api';
import { useRequest } from 'ahooks';
import { useLanguage } from '@/hooks/LanguageProvider';
import { useLocalizedFormV2 } from '@/hooks/useLocalizedFormV2';
import { extractCurrentLocaleValue } from '@/utils/localizedForm';
import { useTranslation } from '@/hooks/useTranslation';

interface BlogCategoryModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  editingCategory?: {
    id: string;
    name: Record<string, string | undefined> | string;
    slug: string;
    description?: Record<string, string | undefined> | string;
  } | null;
  onSuccessAction: () => void;
}

export const BlogCategoryModal: React.FC<BlogCategoryModalProps> = ({
  isOpen,
  onCloseAction,
  editingCategory,
  onSuccessAction,
}) => {
  const isEditing = !!editingCategory;
  const { t } = useTranslation();

  const { run: createCategory, loading: isCreating } = useRequest(
    blogApi.createCategory,
    {
      manual: true,
      onSuccess: (result: any) => {
        // 403 权限不足：withRetry 已弹 toast，静默返回
        if (!result) return;
        onSuccessAction();
        onCloseAction();
      },
      onError: (error) => {
        console.error('Failed to create category:', error);
      },
    },
  );

  const { run: updateCategory, loading: isUpdating } = useRequest(
    blogApi.updateCategory,
    {
      manual: true,
      onSuccess: (result: any) => {
        // 403 权限不足：withRetry 已弹 toast，静默返回
        if (!result) return;
        onSuccessAction();
        onCloseAction();
      },
      onError: (error) => {
        console.error('Failed to update category:', error);
      },
    },
  );

  const { locale } = useLanguage();

  // 修复: 在数据入口处提取当前语言的字符串，避免[object Object]问题
  const getDefaultValues = useCallback(() => {
    if (!editingCategory) {
      return {
        name: '',
        slug: '',
        description: '',
      };
    }

    // 确保返回的值100%是字符串，而不是对象
    const safeName = extractCurrentLocaleValue(editingCategory.name, locale);
    const safeDescription = extractCurrentLocaleValue(
      editingCategory.description,
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
      ...editingCategory,
      name: finalName,
      description: finalDescription,
      slug: editingCategory.slug || '',
    };
  }, [editingCategory, locale]);

  const blogForm = useBlogForm({
    schema: categorySchema,
    defaultValues: undefined, // Don't pass default values here, let useEffect handle it
    onSubmitAction: async (data) => {
      if (isEditing && editingCategory) {
        await updateCategory(editingCategory.id, data);
      } else {
        await createCategory(data);
      }
    },
  });

  const { form, submitHandler, isLoading } = blogForm;
  const { reset, register, getValues } = form;
  const { localize } = useLocalizedFormV2({
    watchAction: form.watch,
    setValueAction: form.setValue,
    getValuesAction: form.getValues,
    locale,
    availableLocales: ['zh', 'en'],
  });

  // 调试：检查表单值和本地化处理
  useEffect(() => {
    if (isOpen && editingCategory) {
      const nameValue = form.watch('name');
      const descriptionValue = form.watch('description');
      const localizedName = localize('name');
      const localizedDescription = localize('description');

      console.log('Debug BlogCategoryModal:', {
        editingCategory,
        locale,
        nameValue,
        descriptionValue,
        nameValueType: typeof nameValue,
        descriptionValueType: typeof descriptionValue,
        nameIsObject: nameValue && typeof nameValue === 'object',
        descriptionIsObject:
          descriptionValue && typeof descriptionValue === 'object',
        localizedName,
        localizedDescription,
        getDefaultValues: getDefaultValues(),
      });
    }
  }, [isOpen, editingCategory, locale, form, localize, getDefaultValues]);

  useEffect(() => {
    if (isOpen) {
      const defaultValues = getDefaultValues();
      console.log(
        'DEBUG BlogCategoryModal useEffect - getDefaultValues() returns:',
        defaultValues,
      );
      console.log(
        'DEBUG BlogCategoryModal useEffect - reset() called with:',
        defaultValues,
      );
      // 类型断言：我们的值符合 CategoryFormInputs 类型
      reset(defaultValues as any);
    } else {
      // 弹窗关闭时完全重置表单 - 使用字符串而不是对象，避免类型错误
      const resetValues = {
        name: '',
        slug: '',
        description: '',
      };
      console.log(
        'DEBUG BlogCategoryModal useEffect - modal closing, reset() called with:',
        resetValues,
      );
      reset(resetValues as any);
      // useLocalizedFormV2 不需要清理函数，它会自动管理状态
    }
  }, [isOpen, reset, editingCategory, getDefaultValues]);

  const loading = isCreating || isUpdating || isLoading;

  // Debug logging
  if (isOpen) {
    const localizedNameProps = localize('name');
    console.log('DEBUG BlogCategoryModal - localize("name") returns:', {
      localizedNameProps,
      value: localizedNameProps.value,
      valueType: typeof localizedNameProps.value,
      isObject: typeof localizedNameProps.value === 'object',
      stringValue: String(localizedNameProps.value),
      formValues: form.getValues(),
      editingCategory,
      locale,
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={
        isEditing
          ? t('categories_modalTitleEdit')
          : t('categories_modalTitleCreate')
      }
      size="md"
    >
      <Form {...form}>
        <form onSubmit={submitHandler} className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium">{t('categories_name')}</h3>
          </div>
          <FormTextField
            label=""
            placeholder={t('categories_namePlaceholder')}
            required
            {...localize('name')}
          />
          <FormTextField
            label={t('categories_slug')}
            placeholder={t('categories_slugPlaceholder')}
            required
            {...register('slug')}
          />
          <FormTextareaField
            label={t('categories_description')}
            placeholder={t('categories_descriptionPlaceholder')}
            {...localize('description')}
          />
          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onCloseAction}
              disabled={loading}
            >
              {t('categories_cancel')}
            </Button>
            <Button type="submit" isLoading={loading}>
              {isEditing ? t('categories_update') : t('categories_create')}
            </Button>
          </div>
        </form>
      </Form>
    </Modal>
  );
};
