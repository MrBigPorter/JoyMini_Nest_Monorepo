'use client';

import React, { useEffect } from 'react';
import { Modal, Button } from '@/components/UIComponents';
import { Form, FormTextField, FormTextareaField } from '@repo/ui/form';
import { useBlogForm } from '@/hooks/useBlogForm';
import { tagSchema } from '@/schema/blog';
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

  const form = useBlogForm({
    schema: tagSchema,
    defaultValues: editingTag || {
      name: '',
      color: '#3b82f6',
      description: '',
    },
    onSubmit: async (data) => {
      if (isEditing && editingTag) {
        updateTag(editingTag.id, data);
      } else {
        createTag(data);
      }
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset(editingTag || { name: '', color: '#3b82f6', description: '' });
    }
  }, [isOpen, editingTag, form]);

  const loading = isCreating || isUpdating || form.formState.isSubmitting;

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={`${isEditing ? 'Edit' : 'Create'} Tag`}
      size="md"
    >
      <Form {...form}>
        <form onSubmit={form.submitHandler} className="space-y-4">
          <FormTextField
            name="name"
            label="Name"
            placeholder="Enter tag name"
            required
          />
          <FormTextField name="color" label="Color" placeholder="#3b82f6" />
          <FormTextareaField
            name="description"
            label="Description"
            placeholder="Optional description"
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
