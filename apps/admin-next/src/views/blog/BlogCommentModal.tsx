'use client';

import React, { useEffect } from 'react';
import { Modal, Button } from '@/components/UIComponents';
import { FormSelectField, FormTextareaField } from '@repo/ui/form';
import { useBlogForm } from '@/hooks/useBlogForm';
import {
  commentModerationSchema,
  type CommentModerationInputs,
} from '@/schema/blog';
import { blogApi } from '@/api';
import { useRequest } from 'ahooks';

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

  const { register, submitHandler, isLoading, reset } = useBlogForm({
    schema: commentModerationSchema,
    defaultValues: editingComment || {
      status: 'PENDING',
      reply: '',
    },
    onSubmit: async (data) => {
      if (isEditing && editingComment) {
        await updateComment(editingComment.id, data);
      }
    },
  });

  useEffect(() => {
    if (isOpen) {
      reset(editingComment || { status: 'PENDING', reply: '' });
    }
  }, [isOpen, editingComment, reset]);

  const loading = isUpdating || isLoading;

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title="Moderate Comment"
      size="md"
    >
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
        <FormTextareaField
          label="Reply (optional)"
          placeholder="Add a public reply to the comment"
          {...register('reply')}
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
    </Modal>
  );
};
