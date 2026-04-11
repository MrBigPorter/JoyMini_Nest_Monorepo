'use client';

import React, { useEffect } from 'react';
import { Modal, Button } from '@/components/UIComponents';
import { Form, FormTextField, FormTextareaField } from '@repo/ui/form';
import { useBlogForm } from '@/hooks/useBlogForm';
import { categorySchema } from '@/schema/blog';
import { blogApi } from '@/api';
import { useRequest } from 'ahooks';
import { useLanguage } from '@/hooks/LanguageProvider';
import { useLocalizedForm } from '@/hooks/useLocalizedForm';
import { LanguageSwitch } from '@/components/blog/LanguageSwitch';

interface BlogCategoryModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  editingCategory?: {
    id: string;
    name: string;
    slug: string;
    description?: string;
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

  const { run: createCategory, loading: isCreating } = useRequest(
    blogApi.createCategory,
    {
      manual: true,
      onSuccess: () => {
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
      onSuccess: () => {
        onSuccessAction();
        onCloseAction();
      },
      onError: (error) => {
        console.error('Failed to update category:', error);
      },
    },
  );

  // 兼容旧数据格式: 自动把 string 转换成 LocalizedString 格式
  const getDefaultValues = () => {
    if (!editingCategory) {
      return {
        name: { zh: '', en: '' },
        slug: '',
        description: { zh: '', en: '' },
      };
    }

    return {
      ...editingCategory,
      name:
        typeof editingCategory.name === 'string'
          ? { zh: editingCategory.name, en: '' }
          : editingCategory.name,
      description:
        typeof editingCategory.description === 'string'
          ? { zh: editingCategory.description, en: '' }
          : editingCategory.description,
    };
  };

  const blogForm = useBlogForm({
    schema: categorySchema,
    defaultValues: getDefaultValues(),
    onSubmitAction: async (data) => {
      if (isEditing && editingCategory) {
        await updateCategory(editingCategory.id, data);
      } else {
        await createCategory(data);
      }
    },
  });

  const { form, submitHandler, isLoading } = blogForm;
  const { reset, register } = form;
  const { locale } = useLanguage();
  const { localize } = useLocalizedForm({
    watch: form.watch,
    setValue: form.setValue,
    errors: form.formState.errors,
    locale,
  });

  useEffect(() => {
    if (isOpen) {
      reset(getDefaultValues());
    }
  }, [isOpen, reset, editingCategory]);

  const loading = isCreating || isUpdating || isLoading;

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={`${isEditing ? 'Edit' : 'Create'} Category`}
      size="md"
    >
      <Form {...form}>
        <form onSubmit={submitHandler} className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium">Name</h3>
            <LanguageSwitch />
          </div>
          <FormTextField
            label=""
            placeholder="Enter category name"
            required
            {...localize('name')}
          />
          <FormTextField
            label="Slug"
            placeholder="e.g., news-articles"
            required
            {...register('slug')}
          />
          <FormTextareaField
            label="Description"
            placeholder="Optional description"
            {...localize('description')}
          />
          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onCloseAction}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={loading}>
              {isEditing ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </Form>
    </Modal>
  );
};
