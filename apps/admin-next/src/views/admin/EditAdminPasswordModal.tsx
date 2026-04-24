'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRequest } from 'ahooks';
import { Modal, Input, Button } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { useAuthStore } from '@/store/useAuthStore';
import { AdminUpdatePassword, AdminUser } from '@/type/types';
import { userApi } from '@/api';
import { useTranslation } from '@/hooks/useTranslation';

const editAdminPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type EditAdminPasswordFormInputs = z.infer<typeof editAdminPasswordSchema>;

interface EditAdminPasswordModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  editingUser: AdminUser | null;
  onSuccessAction: () => void;
}

export const EditAdminPasswordModal: React.FC<EditAdminPasswordModalProps> = ({
  isOpen,
  onCloseAction,
  editingUser,
  onSuccessAction,
}) => {
  const { t } = useTranslation();
  const addToast = useToastStore((state) => state.addToast);
  const currentUserRole = useAuthStore((state) => state.userInfo?.role);
  const isSuperAdmin = currentUserRole === 'SUPER_ADMIN';
  // 非 SUPER_ADMIN 不能重置 SUPER_ADMIN 的密码
  const resetLocked = editingUser?.role === 'SUPER_ADMIN' && !isSuperAdmin;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditAdminPasswordFormInputs>({
    resolver: zodResolver(editAdminPasswordSchema),
  });

  const { run: updateUser, loading: isUpdating } = useRequest(
    userApi.updateUser,
    {
      manual: true,
      onSuccess: () => {
        addToast('success', t('adminUsers.updatedSuccess'));
        onSuccessAction();
        onCloseAction();
      },
    },
  );

  const onSubmit = (data: EditAdminPasswordFormInputs) => {
    if (editingUser) {
      const updateData: AdminUpdatePassword = { ...data };
      updateUser(editingUser.id, updateData);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={t('adminUsers.resetPwdTitle', {
        username: editingUser?.username ?? '',
      })}
      size="lg"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {resetLocked ? (
          <p className="text-sm text-amber-500 py-4 text-center">
            Only Super Admin can reset a Super Admin&apos;s password.
          </p>
        ) : (
          <Input
            label={t('adminUsers.resetPwdField')}
            error={errors.password?.message}
            {...register('password')}
          />
        )}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-white/5">
          <Button type="button" variant="ghost" onClick={onCloseAction}>
            {t('adminUsers.cancel')}
          </Button>
          <Button type="submit" disabled={resetLocked} isLoading={isUpdating}>
            {t('adminUsers.saveChanges')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
