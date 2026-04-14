'use client';

import React, { useEffect } from 'react';
import { Modal, Button } from '@/components/UIComponents';
import { Form, FormSelectField, FormTextareaField } from '@repo/ui/form';
import { useBlogForm } from '@/hooks/useBlogForm';
import {
  commentModerationSchema,
  type CommentModerationInputs,
} from '@/schema/blog';
import { blogApi } from '@/api';
import { useRequest } from 'ahooks';
import { useLanguage } from '@/hooks/LanguageProvider';
import { useLocalizedFormV2 } from '@/hooks/useLocalizedFormV2';
import { LanguageSwitch } from '@/components/blog/LanguageSwitch';
import {
  extractCurrentLocaleValue,
  normalizeLocalizedValue,
} from '@/utils/localizedForm';

interface BlogCommentModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  editingComment?:
    | (Partial<CommentModerationInputs> & {
        id: string;
        content?: string;
        author?: string;
      })
    | null;
  onSuccessAction: () => void;
}

export const BlogCommentModal: React.FC<BlogCommentModalProps> = ({
  isOpen,
  onCloseAction,
  editingComment,
  onSuccessAction,
}) => {
  const isEditing = !!editingComment;

  const { run: updateComment, loading: isUpdating } = useRequest(
    blogApi.updateComment,
    {
      manual: true,
      onSuccess: () => {
        onSuccessAction();
        onCloseAction();
      },
    },
  );

  // 兼容旧数据格式: 自动把 string 转换成 LocalizedString 格式
  const getDefaultValues = () => {
    if (!editingComment) {
      return {
        status: 'PENDING' as const,
        reply: { zh: '', en: '' },
      };
    }

    const status = editingComment.status || 'PENDING';

    return {
      ...editingComment,
      status: status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'SPAM',
      reply: normalizeLocalizedValue(editingComment.reply),
    };
  };

  const blogForm = useBlogForm({
    schema: commentModerationSchema,
    defaultValues: getDefaultValues(),
    onSubmitAction: async (data) => {
      if (isEditing && editingComment) {
        await updateComment(editingComment.id, data);
      }
    },
  });

  const { form, submitHandler, isLoading } = blogForm;
  const { register, reset, getValues } = form;
  const { locale } = useLanguage();
  const { localize } = useLocalizedFormV2({
    watch: form.watch,
    setValue: form.setValue,
    getValues: form.getValues,
    locale,
    availableLocales: ['zh', 'en'],
  });

  useEffect(() => {
    if (isOpen) {
      form.reset(getDefaultValues());
    }
  }, [isOpen, form, editingComment, getDefaultValues]);

  const loading = isUpdating || isLoading;

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title="Moderate Comment"
      size="md"
    >
      <Form {...form}>
        <form onSubmit={submitHandler} className="space-y-4">
          <FormSelectField
            label="Status"
            options={[
              { label: 'Pending', value: 'PENDING' },
              { label: 'Approved', value: 'APPROVED' },
              { label: 'Rejected', value: 'REJECTED' },
              { label: 'Spam', value: 'SPAM' },
            ]}
            {...register('status')}
          />
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium">Reply (optional)</h3>
            <LanguageSwitch />
          </div>
          <FormTextareaField
            label=""
            placeholder="Add a public reply to the comment"
            {...localize('reply')}
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
              Update
            </Button>
          </div>
        </form>
      </Form>
    </Modal>
  );
};
