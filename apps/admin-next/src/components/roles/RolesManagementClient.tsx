'use client';

import React, { useState, useEffect } from 'react';
import { useRequest } from 'ahooks';
import {
  Shield,
  Users,
  ChevronDown,
  ChevronUp,
  Crown,
  Eye,
  Edit3,
  DollarSign,
  UserCog,
} from 'lucide-react';
import { Card, Badge } from '@/components/UIComponents';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { rolesApi, userApi } from '@/api';
import { EditAdminUserModal } from '@/views/admin/EditAdminUserModal';
import type { AdminUser, RoleSummaryItem } from '@/type/types';

// ── Role icon + color map ──────────────────────────────────────────
const ROLE_STYLE: Record<
  string,
  { icon: React.ReactNode; color: string; bg: string; border: string }
> = {
  SUPER_ADMIN: {
    icon: <Crown size={20} className="text-amber-500" />,
    color: 'text-amber-600',
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    border: 'border-amber-200 dark:border-amber-500/30',
  },
  ADMIN: {
    icon: <Shield size={20} className="text-indigo-500" />,
    color: 'text-indigo-600',
    bg: 'bg-indigo-50 dark:bg-indigo-500/10',
    border: 'border-indigo-200 dark:border-indigo-500/30',
  },
  EDITOR: {
    icon: <Edit3 size={20} className="text-emerald-500" />,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    border: 'border-emerald-200 dark:border-emerald-500/30',
  },
  VIEWER: {
    icon: <Eye size={20} className="text-sky-500" />,
    color: 'text-sky-600',
    bg: 'bg-sky-50 dark:bg-sky-500/10',
    border: 'border-sky-200 dark:border-sky-500/30',
  },
  FINANCE: {
    icon: <DollarSign size={20} className="text-violet-500" />,
    color: 'text-violet-600',
    bg: 'bg-violet-50 dark:bg-violet-500/10',
    border: 'border-violet-200 dark:border-violet-500/30',
  },
};

const DEFAULT_STYLE = {
  icon: <UserCog size={20} className="text-gray-500" />,
  color: 'text-gray-600',
  bg: 'bg-gray-50 dark:bg-white/5',
  border: 'border-gray-200 dark:border-white/10',
};

// ── Permission badge ────────────────────────────────────────────────
function PermBadge({ action }: { action: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300">
      {action}
    </span>
  );
}

// ── Role Card ───────────────────────────────────────────────────────
function RoleCard({
  item,
  onSelectRole,
  isSelected,
}: {
  item: RoleSummaryItem;
  onSelectRole: (role: string) => void;
  isSelected: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const style = ROLE_STYLE[item.role] ?? DEFAULT_STYLE;
  const moduleEntries = Object.entries(item.permissionsByModule);

  return (
    <Card
      className={`border-2 transition-all duration-200 cursor-pointer ${style.border} ${
        isSelected
          ? 'ring-2 ring-primary-500 ring-offset-1 dark:ring-offset-dark-900'
          : 'hover:shadow-md'
      }`}
      onClick={() => onSelectRole(item.role)}
    >
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${style.bg}`}
          >
            {style.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className={`font-bold text-base ${style.color}`}>
                {item.nameEn}
              </h3>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {item.nameZh}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
              {item.description}
            </p>
          </div>
          <div className="flex-shrink-0 flex flex-col items-end gap-1">
            <Badge color="blue">{item.userCount} users</Badge>
          </div>
        </div>

        {/* Permission summary */}
        <div className="mt-4">
          {item.role === 'SUPER_ADMIN' ? (
            <div className="flex items-center gap-2">
              <Crown size={13} className="text-amber-500" />
              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                Full access — all modules
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {item.permissions.length} permission
                  {item.permissions.length !== 1 ? 's' : ''} across{' '}
                  {moduleEntries.length} module
                  {moduleEntries.length !== 1 ? 's' : ''}
                </span>
                <button
                  className="flex items-center gap-1 text-xs text-primary-500 hover:text-primary-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((v) => !v);
                  }}
                >
                  {expanded ? (
                    <>
                      <ChevronUp size={13} /> Hide
                    </>
                  ) : (
                    <>
                      <ChevronDown size={13} /> Details
                    </>
                  )}
                </button>
              </div>

              {expanded && (
                <div className="space-y-2 mt-2">
                  {moduleEntries.map(([mod, actions]) => (
                    <div key={mod}>
                      <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        {mod}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {actions.map((a) => (
                          <PermBadge key={a} action={a} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Users in role drawer / inline panel ────────────────────────────
function RoleUsersPanel({
  role,
  roleName,
  onClose,
}: {
  role: string;
  roleName: string;
  onClose: () => void;
}) {
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const { data, loading, refresh } = useRequest(
    () =>
      userApi.getUsers({ role, pageSize: 100 } as Parameters<
        typeof userApi.getUsers
      >[0]),
    { refreshDeps: [role] },
  );

  const users = data?.list ?? [];

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-white/5 bg-white dark:bg-dark-900 shadow-lg overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-primary-500" />
          <span className="font-semibold text-gray-800 dark:text-white">
            Admins with role:{' '}
            <span className="text-primary-500">{roleName}</span>
          </span>
          <Badge color="blue">{users.length}</Badge>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-sm"
        >
          ✕ Close
        </button>
      </div>

      {/* User list */}
      <div className="p-4">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 rounded-xl bg-gray-100 dark:bg-white/5 animate-pulse"
              />
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">
            No admin users with this role.
          </div>
        ) : (
          <div className="space-y-2">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 text-sm font-semibold">
                    {(user.realName || user.username)?.[0]?.toUpperCase() ??
                      '?'}
                  </div>
                  <div>
                    <div className="font-medium text-sm text-gray-800 dark:text-white">
                      {user.realName || user.username}
                    </div>
                    <div className="text-xs text-gray-400">
                      @{user.username}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      user.status === 1
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {user.status === 1 ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    onClick={() => {
                      setEditingUser(user);
                      setIsEditOpen(true);
                    }}
                    className="text-xs text-primary-500 hover:text-primary-600 font-medium"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <EditAdminUserModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        editingUser={editingUser}
        onSuccess={refresh}
      />
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────
export function RolesManagement() {
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const {
    data: roles,
    loading,
    error,
  } = useRequest(rolesApi.getSummary, {
    cacheKey: 'roles-summary',
    ready: mounted,
  });

  const selectedItem = roles?.find((r) => r.role === selectedRole);

  const handleSelectRole = (role: string) => {
    setSelectedRole((prev) => (prev === role ? null : role));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role & Permission Management"
        description="View role definitions and manage role assignments for admin users."
      />

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-4 text-sm text-red-600 dark:text-red-400">
          Failed to load roles summary. You may not have permission to view this
          page.
        </div>
      )}

      {/* Role cards grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-44 rounded-2xl bg-gray-100 dark:bg-white/5 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {(roles ?? []).map((item) => (
            <RoleCard
              key={item.role}
              item={item}
              isSelected={selectedRole === item.role}
              onSelectRole={handleSelectRole}
            />
          ))}
        </div>
      )}

      {/* Users panel — shown when a role card is selected */}
      {selectedRole && selectedItem && (
        <RoleUsersPanel
          role={selectedRole}
          roleName={selectedItem.nameEn}
          onClose={() => setSelectedRole(null)}
        />
      )}
    </div>
  );
}
