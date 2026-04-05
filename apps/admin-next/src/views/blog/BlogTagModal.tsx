'use client';

import React, { useEffect } from 'react';
import { Modal, Button } from '@/components/UIComponents';
import { FormTextField, FormTextareaField } from '@repo/ui/form';
import { useBlogForm } from '@/hooks/useBlogForm';
import { tagSchema, type TagFormInputs } from '@/schema/blog';
import { blogApi } from '@/api';
import { useRequest } from 'ahooks';

interface BlogTagModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  editingTag?: {
    id: string;
    name: string;
    color?: string;
    description?: string;
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

  const { register, submitHandler, isLoading, errors, reset } = useBlogForm({
    schema: tagSchema,
    defaultValues: editingTag || {
      name: '',
      color: '#3b82f6',
      description: '',
    },
    onSubmit: async (data) => {
      if (isEditing && editingTag) {
        await updateTag(editingTag.id, data);
      } else {
        await createTag(data);
      }
    },
  });

  useEffect(() => {
    if (isOpen) {
      reset(editingTag || { name: '', color: '#3b82f6', description: '' });
    }
  }, [isOpen, editingTag, reset]);

  const loading = isCreating || isUpdating || isLoading;

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={`${isEditing ? 'Edit' : 'Create'} Tag`}
      size="md"
    >
      <form onSubmit={submitHandler} className="space-y-4">
        <FormTextField
          label="Name"
          placeholder="Enter tag name"
          required
          {...register('name')}
        />
        <FormTextField
          label="Color"
          placeholder="#3b82f6"
          {...register('color')}
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
    </Modal>
  );
};
