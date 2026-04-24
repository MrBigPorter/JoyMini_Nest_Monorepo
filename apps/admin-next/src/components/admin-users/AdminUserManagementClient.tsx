'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle, Edit3, User as UserIcon, Key } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Card, Badge } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { AdminUser } from '@/type/types';
import { userApi, applicationApi } from '@/api';
import { useRequest } from 'ahooks';
import { createColumnHelper, ColumnDef } from '@tanstack/react-table';
import { useAuthStore } from '@/store/useAuthStore';
import { useTranslation } from '@/hooks/useTranslation';
import { CreateAdminUserModal } from '@/views/admin/CreateAdminUserModal';
import { EditAdminUserModal } from '@/views/admin/EditAdminUserModal';
import { EditAdminPasswordModal } from '@/views/admin/EditAdminPasswordModal';
import { ApplicationsManagement } from '@/views/admin/ApplicationsManagement';
import { Button } from '@repo/ui';
import { BaseTable } from '@/components/scaffold/BaseTable';
import { SchemaSearchForm } from '@/components/scaffold/SchemaSearchForm';
import { PageHeader } from '@/components/scaffold/PageHeader';
import {
  adminUsersListQueryKey,
  buildAdminUsersListParams,
  parseAdminUsersSearchParams,
} from '@/lib/cache/admin-users-cache';

const PENDING_APPLICATIONS_UPDATED_EVENT = 'applications:pending-updated';

type AdminUserSearchForm = {
  username: string;
  realName: string;
  role: string;
  status: string;
};

interface AdminUserManagementProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

export const AdminUserManagement: React.FC<AdminUserManagementProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
  const { t } = useTranslation();
  const addToast = useToastStore((state) => state.addToast);
  const userInfo = useAuthStore((state) => state.userInfo);
  const canReviewApplications = userInfo?.role === 'SUPER_ADMIN';
  const isSuperAdmin = userInfo?.role === 'SUPER_ADMIN';
  const [activeTab, setActiveTab] = useState<'users' | 'applications'>('users');
  const normalizedInitialQuery = useMemo(() => {
    const input = initialFormParams ?? {};
    return parseAdminUsersSearchParams({
      page: typeof input.page === 'string' ? input.page : undefined,
      pageSize: typeof input.pageSize === 'string' ? input.pageSize : undefined,
      username: typeof input.username === 'string' ? input.username : undefined,
      realName: typeof input.realName === 'string' ? input.realName : undefined,
      role: typeof input.role === 'string' ? input.role : undefined,
      status: typeof input.status === 'string' ? input.status : undefined,
    });
  }, [initialFormParams]);
  const [pagination, setPagination] = useState({
    page: normalizedInitialQuery.page,
    pageSize: normalizedInitialQuery.pageSize,
  });
  const [filters, setFilters] = useState<AdminUserSearchForm>({
    username: normalizedInitialQuery.username ?? '',
    realName: normalizedInitialQuery.realName ?? '',
    role: normalizedInitialQuery.role ?? 'ALL',
    status:
      normalizedInitialQuery.status !== undefined
        ? String(normalizedInitialQuery.status)
        : 'ALL',
  });

  // Pending applications count for badge
  const { data: pendingData, refresh: refreshPendingCount } = useRequest(
    () => applicationApi.pendingCount(),
    {
      ready: canReviewApplications,
      refreshDeps: [activeTab],
      onError: () => {
        // 403/401 等错误由 http 层处理，这里保持静默
      },
    },
  );
  const pendingCount = pendingData?.count ?? 0;

  useEffect(() => {
    const handler = () => {
      void refreshPendingCount();
    };

    window.addEventListener(PENDING_APPLICATIONS_UPDATED_EVENT, handler);
    return () => {
      window.removeEventListener(PENDING_APPLICATIONS_UPDATED_EVENT, handler);
    };
  }, [refreshPendingCount]);

  // Modal states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null);
  const [isResetPwdModalOpen, setIsResetPwdModalOpen] = useState(false);
  const [resetPwdAdmin, setResetPwdAdmin] = useState<AdminUser | null>(null);

  const usersQueryInput = useMemo(
    () =>
      parseAdminUsersSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
        username: filters.username,
        realName: filters.realName,
        role: filters.role,
        status: filters.status,
      }),
    [filters, pagination.page, pagination.pageSize],
  );

  const {
    data: usersData,
    isFetching: usersLoading,
    refetch: refresh,
  } = useQuery({
    queryKey: adminUsersListQueryKey(usersQueryInput),
    queryFn: () => userApi.getUsers(buildAdminUsersListParams(usersQueryInput)),
    staleTime: 30_000,
    enabled: activeTab === 'users',
  });

  const total = usersData?.total ?? 0;
  const dataSource = (usersData?.list ?? []) as AdminUser[];

  // -------------------- 列表操作 --------------------

  const handleCreate = () => {
    setIsCreateModalOpen(true);
  };

  const handleEdit = (admin: AdminUser) => {
    setEditingAdmin(admin);
    setIsEditModalOpen(true);
  };

  const { run: updateUser, loading: isUpdating } = useRequest(
    userApi.updateUser,
    {
      manual: true,
      onSuccess: (data) => {
        addToast(
          'success',
          t('adminUsers.statusChanged', {
            username: data.username,
            status:
              data.status === 1
                ? t('adminUsers.activate').toLowerCase()
                : t('adminUsers.disable').toLowerCase(),
          }),
        );
        void refresh();
      },
    },
  );
  const handleToggleStatus = useCallback(
    async (admin: AdminUser) => {
      if (admin.role === 'SUPER_ADMIN' && !isSuperAdmin) {
        addToast('error', t('adminUsers.onlySuperAdminModify'));
        return;
      }
      const newStatus = admin.status === 1 ? 0 : 1;
      updateUser(admin.id, { status: newStatus });
    },
    [updateUser, addToast, isSuperAdmin],
  );

  const handleOpenResetPwd = (admin: AdminUser) => {
    setResetPwdAdmin(admin);
    setIsResetPwdModalOpen(true);
  };
  // 搜索回调：直接拿到所有值
  const handleSearch = (values: AdminUserSearchForm) => {
    setFilters(values);
    setPagination((prev) => ({ ...prev, page: 1 }));
    onParamsChange?.(values);
  };

  const handleReset = () => {
    setFilters({
      username: '',
      realName: '',
      role: 'ALL',
      status: 'ALL',
    });
    setPagination((prev) => ({ ...prev, page: 1 }));
    onParamsChange?.({
      username: '',
      realName: '',
      role: 'ALL',
      status: 'ALL',
    });
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // ColumnDef<AdminUser, any>: 混합多个 accessor 列时，各列值类型不同（string/number 等），
  // 若写 ColumnDef<AdminUser> 则默认展开为 unknown，在逆变位置与具体类型不兼容（TS2322）
  const columns: ColumnDef<AdminUser, any>[] = useMemo(() => {
    const columnHelper = createColumnHelper<AdminUser>();

    return [
      columnHelper.accessor('id', {
        header: t('adminUsers.columnId'),
        cell: (info) => (
          <span className="font-mono text-xs text-gray-500">
            {info.getValue().substring(0, 8)}...
          </span>
        ),
      }),
      columnHelper.accessor('username', {
        header: t('adminUsers.columnUsername'),
        cell: (info) => (
          <div className="flex items-center gap-2 font-medium text-gray-900 dark:text-white">
            <div className="p-1.5 bg-gray-100 dark:bg-white/10 rounded-full">
              <UserIcon
                size={14}
                className="text-gray-500 dark:text-gray-400"
              />
            </div>
            {info.getValue()}
          </div>
        ),
      }),
      columnHelper.accessor('realName', {
        header: t('adminUsers.columnRealName'),
        cell: (info) => (
          <span className="text-gray-600 dark:text-gray-400">
            {info.getValue() || '-'}
          </span>
        ),
      }),
      columnHelper.accessor('role', {
        header: t('adminUsers.columnRole'),
        cell: (info) => {
          const role = info.getValue();
          let color: 'gray' | 'purple' | 'blue' | 'green' = 'gray';
          if (role === 'SUPER_ADMIN') color = 'purple';
          else if (role === 'ADMIN') color = 'blue';
          else if (role === 'EDITOR') color = 'green';

          return <Badge color={color}>{role}</Badge>;
        },
      }),
      columnHelper.accessor('status', {
        header: t('adminUsers.columnStatus'),
        cell: (info) => (
          <Badge color={info.getValue() === 1 ? 'green' : 'red'}>
            {info.getValue() === 1
              ? t('adminUsers.statusActive')
              : t('adminUsers.statusDisabled')}
          </Badge>
        ),
      }),
      columnHelper.accessor('lastLoginAt', {
        header: t('adminUsers.columnLastLogin'),
        cell: (info) => (
          <div className="text-xs text-gray-500">
            {/* suppressHydrationWarning: toLocaleString() 依赖本地时区，
                SSR（UTC）与客户端结果不同，属于预期行为，不是 bug */}
            <div suppressHydrationWarning>
              {info.getValue()
                ? new Date(Number(info.getValue())).toLocaleString()
                : t('adminUsers.neverLogin')}
            </div>
            {info.row.original.lastLoginIp && (
              <div className="font-mono mt-0.5 opacity-75">
                {info.row.original.lastLoginIp}
              </div>
            )}
          </div>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: t('adminUsers.columnActions'),
        cell: (info) => {
          const isTargetSuper = info.row.original.role === 'SUPER_ADMIN';
          // 非 SUPER_ADMIN 不能操作 SUPER_ADMIN 账号
          const actionsLocked = isTargetSuper && !isSuperAdmin;
          return (
            <div className="flex  gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={actionsLocked}
                onClick={() => handleEdit(info.row.original)}
                title={
                  actionsLocked
                    ? t('adminUsers.onlySuperAdminEdit')
                    : t('adminUsers.edit')
                }
              >
                <Edit3 size={16} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={actionsLocked}
                onClick={() => handleOpenResetPwd(info.row.original)}
                title={
                  actionsLocked
                    ? t('adminUsers.onlySuperAdminReset')
                    : t('adminUsers.resetPassword')
                }
              >
                <Key size={16} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={isUpdating || actionsLocked}
                isLoading={isUpdating}
                className={
                  info.row.original.status === 1
                    ? 'text-red-500 hover:text-red-600'
                    : 'text-green-500 hover:text-green-600'
                }
                onClick={() => handleToggleStatus(info.row.original)}
                title={
                  actionsLocked
                    ? t('adminUsers.onlySuperAdminModify')
                    : info.row.original.status === 1
                      ? t('adminUsers.disable')
                      : t('adminUsers.activate')
                }
              >
                {info.row.original.status === 1 ? (
                  <Ban size={16} />
                ) : (
                  <CheckCircle size={16} />
                )}
              </Button>
            </div>
          );
        },
      }),
    ];
  }, [
    handleToggleStatus,
    isUpdating,
    isSuperAdmin,
    handleEdit,
    handleOpenResetPwd,
  ]);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('adminUsers.pageTitle')}
        description={t('adminUsers.pageDescription')}
        buttonText={
          activeTab === 'users' ? t('adminUsers.addNewAdmin') : undefined
        }
        buttonOnClick={activeTab === 'users' ? handleCreate : undefined}
      />

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-dark-800 rounded-xl w-fit">
        {(['users', 'applications'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
              activeTab === tab
                ? 'bg-white dark:bg-dark-900 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab === 'users'
              ? t('adminUsers.tabUsers')
              : t('adminUsers.tabApplications')}
            {tab === 'applications' && pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] text-[10px] font-bold bg-red-500 text-white rounded-full flex items-center justify-center px-1">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Applications tab */}
      {activeTab === 'applications' && <ApplicationsManagement />}

      {/* Users tab */}
      {activeTab === 'users' && (
        <>
          <Card>
            <div className="space-y-3 mb-6">
              <SchemaSearchForm<AdminUserSearchForm>
                schema={[
                  {
                    type: 'input',
                    key: 'username',
                    label: t('adminUsers.searchUsername'),
                    placeholder: t('adminUsers.searchUsernamePlaceholder'),
                  },
                  {
                    type: 'input',
                    key: 'realName',
                    label: t('adminUsers.searchRealName'),
                    placeholder: t('adminUsers.searchRealNamePlaceholder'),
                  },
                  {
                    type: 'select',
                    key: 'role',
                    label: t('adminUsers.searchRole'),
                    defaultValue: 'ALL',
                    options: [
                      { label: t('adminUsers.searchAllRoles'), value: 'ALL' },
                      { label: t('adminUsers.roleViewer'), value: 'VIEWER' },
                      { label: t('adminUsers.roleEditor'), value: 'EDITOR' },
                      { label: t('adminUsers.roleAdmin'), value: 'ADMIN' },
                      {
                        label: t('adminUsers.roleSuperAdmin'),
                        value: 'SUPER_ADMIN',
                      },
                    ],
                  },
                  {
                    type: 'select',
                    key: 'status',
                    label: t('adminUsers.searchStatus'),
                    defaultValue: 'ALL',
                    options: [
                      { label: t('adminUsers.searchAllStatus'), value: 'ALL' },
                      { label: t('adminUsers.statusActive'), value: '1' },
                      { label: t('adminUsers.statusDisabled'), value: '0' },
                    ],
                  },
                ]}
                initialValues={{
                  username: filters.username,
                  realName: filters.realName,
                  role: filters.role,
                  status: filters.status,
                }}
                onSearch={handleSearch}
                onReset={handleReset}
                loading={usersLoading}
              />
            </div>
            <BaseTable
              data={dataSource}
              loading={usersLoading}
              rowKey="id"
              columns={columns}
              pagination={{
                current: pagination.page,
                pageSize: pagination.pageSize,
                total,
                onChange: (page, pageSize) => {
                  setPagination({
                    page,
                    pageSize: pageSize || pagination.pageSize || 10,
                  });
                },
              }}
            />
          </Card>

          <CreateAdminUserModal
            isOpen={isCreateModalOpen}
            onCloseAction={() => setIsCreateModalOpen(false)}
            onSuccessAction={() => void refresh()}
          />
          <EditAdminUserModal
            isOpen={isEditModalOpen}
            onCloseAction={() => setIsEditModalOpen(false)}
            editingUser={editingAdmin}
            onSuccessAction={() => void refresh()}
          />

          <EditAdminPasswordModal
            isOpen={isResetPwdModalOpen}
            onCloseAction={() => setIsResetPwdModalOpen(false)}
            onSuccessAction={() => void refresh()}
            editingUser={resetPwdAdmin}
          />
        </>
      )}
    </div>
  );
};
