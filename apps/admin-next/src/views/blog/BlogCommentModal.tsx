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
import { useTranslation } from '@/hooks/useTranslation';

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
  const { t: globalT } = useTranslation();
  const t = (key: string, params?: Record<string, string | number>) =>
    globalT(`blog_comments_${key}`, params);

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
      title={t('modalTitle')}
      size="md"
    >
      <Form {...form}>
        <form onSubmit={submitHandler} className="space-y-4">
          <FormSelectField
            label={t('status')}
            options={[
              { label: t('pending'), value: 'PENDING' },
              { label: t('approved'), value: 'APPROVED' },
              { label: t('rejected'), value: 'REJECTED' },
              { label: t('spam'), value: 'SPAM' },
            ]}
            {...register('status')}
          />
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium">{t('replyOptional')}</h3>
            <LanguageSwitch />
          </div>
          <FormTextareaField
            label=""
            placeholder={t('replyPlaceholder')}
            {...localize('reply')}
          />
          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onCloseAction}
              disabled={loading}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" isLoading={loading}>
              {t('update')}
            </Button>
          </div>
        </form>
      </Form>
    </Modal>
  );
};
