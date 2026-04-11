'use client';

import React, { useEffect } from 'react';
import { Modal, Button } from '@/components/UIComponents';
import { Form, FormTextField, FormTextareaField } from '@repo/ui/form';
import { useBlogForm } from '@/hooks/useBlogForm';
import { tagSchema, type TagFormInputs } from '@/schema/blog';
import { blogApi } from '@/api';
import { useRequest } from 'ahooks';
import { useLanguage } from '@/hooks/LanguageProvider';
import { useLocalizedForm } from '@/hooks/useLocalizedForm';
import { LanguageSwitch } from '@/components/blog/LanguageSwitch';

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

  const getDefaultValues = () => {
    if (!editingTag) {
      return {
        name: { zh: '', en: '' },
        slug: '',
        color: '#3b82f6',
        description: { zh: '', en: '' },
      };
    }

    return {
      ...editingTag,
      name:
        typeof editingTag.name === 'string'
          ? { zh: editingTag.name, en: '' }
          : editingTag.name,
      description:
        typeof editingTag.description === 'string'
          ? { zh: editingTag.description, en: '' }
          : editingTag.description,
    };
  };

  const blogForm = useBlogForm({
    schema: tagSchema,
    defaultValues: getDefaultValues(),
    onSubmitAction: async (data: TagFormInputs) => {
      if (isEditing && editingTag) {
        await updateTag(editingTag.id, data);
      } else {
        await createTag(data);
      }
    },
  });

  const { form, submitHandler, isLoading } = blogForm;
  const { register, reset } = form;
  const { locale } = useLanguage();
  const { localize } = useLocalizedForm({
    watch: form.watch,
    setValue: form.setValue,
    errors: form.formState.errors,
    locale,
  });

  useEffect(() => {
    if (isOpen) {
      form.reset(getDefaultValues());
    }
  }, [isOpen, form, editingTag]);

  const loading = isCreating || isUpdating || isLoading;

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={`${isEditing ? 'Edit' : 'Create'} Tag`}
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
            placeholder="Enter tag name"
            required
            {...localize('name')}
          />
          <FormTextField
            label="Slug"
            placeholder="e.g., technology"
            required
            {...register('slug', { required: true })}
          />
          <FormTextField
            label="Color"
            placeholder="#3b82f6"
            {...register('color')}
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
