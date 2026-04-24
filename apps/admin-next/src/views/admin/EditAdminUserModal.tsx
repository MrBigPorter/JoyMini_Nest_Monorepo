'use client';

import React, { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRequest } from 'ahooks';
import {
  Modal,
  Input,
  Select,
  Button,
  Switch,
} from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { useAuthStore } from '@/store/useAuthStore';
import { AdminUpdateUser, AdminUser } from '@/type/types';
import { userApi } from '@/api';
import { useTranslation } from '@/hooks/useTranslation';

const editAdminUserSchema = z.object({
  realName: z.string().optional(),
  role: z.string(),
  status: z.number(),
});

type EditAdminUserFormInputs = z.infer<typeof editAdminUserSchema>;

interface EditAdminUserModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  editingUser: AdminUser | null;
  onSuccessAction: () => void;
}

export const EditAdminUserModal: React.FC<EditAdminUserModalProps> = ({
  isOpen,
  onCloseAction,
  editingUser,
  onSuccessAction,
}) => {
  const { t } = useTranslation();
  const addToast = useToastStore((state) => state.addToast);
  const currentUserRole = useAuthStore((state) => state.userInfo?.role);
  const isSuperAdmin = currentUserRole === 'SUPER_ADMIN';

  // 非 SUPER_ADMIN 不能把账号设为 SUPER_ADMIN，也不能修改 SUPER_ADMIN 账号的 role
  const isEditingSuper = editingUser?.role === 'SUPER_ADMIN';
  const roleOptions = [
    { label: t('adminUsers.roleViewer'), value: 'VIEWER' },
    { label: t('adminUsers.roleEditor'), value: 'EDITOR' },
    { label: t('adminUsers.roleAdmin'), value: 'ADMIN' },
    ...(isSuperAdmin
      ? [{ label: t('adminUsers.roleSuperAdmin'), value: 'SUPER_ADMIN' }]
      : []),
  ];
  // 非 SUPER_ADMIN 编辑 SUPER_ADMIN 账号时，role 字段锁定（只读）
  const roleDisabled = isEditingSuper && !isSuperAdmin;

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<EditAdminUserFormInputs>({
    resolver: zodResolver(editAdminUserSchema),
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

  useEffect(() => {
    if (isOpen && editingUser) {
      reset({
        realName: editingUser.realName || '',
        role: editingUser.role,
        status: editingUser.status,
      });
    }
  }, [isOpen, editingUser, reset]);

  const onSubmit = (data: EditAdminUserFormInputs) => {
    if (editingUser) {
      const updateData: Partial<AdminUpdateUser> = { ...data };
      updateUser(editingUser.id, updateData);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={t('adminUsers.editTitle', {
        username: editingUser?.username ?? '',
      })}
      size="lg"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label={t('adminUsers.fieldRealName')}
          error={errors.realName?.message}
          {...register('realName')}
        />
        <Select
          label={t('adminUsers.fieldRole')}
          disabled={roleDisabled}
          {...register('role')}
          options={roleOptions}
        />
        {roleDisabled && (
          <p className="text-xs text-amber-500 -mt-2">
            Only Super Admin can modify a Super Admin account&apos;s role.
          </p>
        )}
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('adminUsers.fieldStatus')}
          </label>
          <Controller
            name="status"
            control={control}
            render={({ field }) => (
              <Switch
                checked={field.value === 1}
                disabled={roleDisabled}
                onChangeAction={(checked) => field.onChange(checked ? 1 : 0)}
              />
            )}
          />
        </div>
        {roleDisabled && (
          <p className="text-xs text-amber-500">
            {t('adminUsers.onlySuperAdminAccount')}
          </p>
        )}
        <Button type="submit" isLoading={isUpdating}>
          {t('adminUsers.saveChanges')}
        </Button>
      </form>
    </Modal>
  );
};
