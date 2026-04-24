'use client';

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRequest } from 'ahooks';
import { Modal, Input, Select, Button } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { userApi } from '@/api';
import { useTranslation } from '@/hooks/useTranslation';

const createAdminUserSchema = (t: (key: string) => string) =>
  z.object({
    username: z.string().min(3, t('adminUsers.usernameMinLength')),
    realName: z.string().optional(),
    role: z.string(),
    password: z
      .string()
      .min(6, t('adminUsers.passwordMinLength'))
      .optional()
      .or(z.literal('')),
  });

type CreateAdminUserFormInputs = z.infer<
  ReturnType<typeof createAdminUserSchema>
>;

interface CreateAdminUserModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  onSuccessAction: () => void;
}

export const CreateAdminUserModal: React.FC<CreateAdminUserModalProps> = ({
  isOpen,
  onCloseAction,
  onSuccessAction,
}) => {
  const { t } = useTranslation();
  const addToast = useToastStore((state) => state.addToast);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateAdminUserFormInputs>({
    resolver: zodResolver(createAdminUserSchema(t)),
    defaultValues: {
      username: '',
      realName: '',
      role: 'VIEWER',
      password: '',
    },
  });

  const { run: createUser, loading: isCreating } = useRequest(
    userApi.createUser,
    {
      manual: true,
      onSuccess: () => {
        addToast('success', t('adminUsers.createdSuccess'));
        onSuccessAction();
        onCloseAction();
      },
    },
  );

  useEffect(() => {
    if (isOpen) {
      reset();
    }
  }, [isOpen, reset]);

  const onSubmit = (data: CreateAdminUserFormInputs) => {
    createUser(data);
  };

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={t('adminUsers.createTitle')}
      size="lg"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label={t('adminUsers.fieldUsername')}
          error={errors.username?.message}
          {...register('username')}
        />
        <Input
          label={t('adminUsers.fieldRealName')}
          error={errors.realName?.message}
          {...register('realName')}
        />
        <Input
          label={t('adminUsers.fieldPassword')}
          type="password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Select
          label={t('adminUsers.fieldRole')}
          {...register('role')}
          options={[
            { label: t('adminUsers.roleViewer'), value: 'VIEWER' },
            { label: t('adminUsers.roleEditor'), value: 'EDITOR' },
            { label: t('adminUsers.roleAdmin'), value: 'ADMIN' },
            { label: t('adminUsers.roleSuperAdmin'), value: 'SUPER_ADMIN' },
          ]}
        />

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-white/5">
          <Button type="button" variant="ghost" onClick={onCloseAction}>
            {t('adminUsers.cancel')}
          </Button>
          <Button type="submit" isLoading={isCreating}>
            {t('adminUsers.createUser')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
