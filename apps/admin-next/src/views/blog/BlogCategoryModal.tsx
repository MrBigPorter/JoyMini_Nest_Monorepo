'use client';

import React, { useEffect } from 'react';
import { Modal, Button } from '@/components/UIComponents';
import { Form, FormTextField, FormTextareaField } from '@repo/ui/form';
import { useBlogForm } from '@/hooks/useBlogForm';
import { categorySchema } from '@/schema/blog';
import { blogApi } from '@/api';
import { useRequest } from 'ahooks';

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

  const form = useBlogForm({
    schema: categorySchema,
    defaultValues: editingCategory || {
      name: '',
      slug: '',
      description: '',
    },
    onSubmit: async (data) => {
      if (isEditing && editingCategory) {
        await updateCategory(editingCategory.id, data);
      } else {
        await createCategory(data);
      }
    },
  });
  const { register, submitHandler, isLoading, reset } = form;

  useEffect(() => {
    if (isOpen) {
      reset(editingCategory || { name: '', slug: '', description: '' });
    }
  }, [isOpen, editingCategory, reset]);

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
          <FormTextField
            label="Name"
            placeholder="Enter category name"
            required
            {...register('name')}
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
            {...register('description')}
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
