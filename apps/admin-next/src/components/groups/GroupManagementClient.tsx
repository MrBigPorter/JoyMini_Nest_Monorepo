'use client';

import React, { useCallback, useMemo, useRef } from 'react';
import Image from 'next/image';
import { Users, Timer, Eye } from 'lucide-react';
import { Badge, BadgeColor } from '@/components/UIComponents';
import { Card } from '@/components/UIComponents';
import { AdminGroupItem, AdminGroupListParams } from '@/type/types';
import { groupApi } from '@/api';
import { GROUP_STATUS } from '@lucky/shared';
import {
  SmartTable,
  ProColumns,
  ActionType,
} from '@/components/scaffold/SmartTable';
import { FormSchema } from '@/type/search';
import { Button, ModalManager, cn } from '@repo/ui';
import { SmartImage } from '@/components/ui/SmartImage';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { format, formatDistanceToNow } from 'date-fns';
import { useRequest } from 'ahooks';
import {
  buildGroupsListParams,
  groupsListQueryKey,
  parseGroupsSearchParams,
} from '@/lib/cache/groups-cache';
import { useTranslation } from '@/hooks/useTranslation';

// ── i18n key map for GROUP_STATUS ────────────────────────────────────────────
const GROUP_STATUS_I18N_KEY: Record<number, string> = {
  [GROUP_STATUS.ACTIVE]: 'groups.statusActive',
  [GROUP_STATUS.SUCCESS]: 'groups.statusCompleted',
  [GROUP_STATUS.FAILED]: 'groups.statusFailed',
};

// 表单层类型：select/input 值均为字符串，与 API 层类型解耦
type GroupSearchForm = {
  page?: number;
  pageSize?: number;
  treasureId?: string;
  status?: string; // form 传字符串，如 'ALL' / '1' / '2'
  includeExpired?: boolean | string;
};

const normalizeIncludeExpired = (value: unknown): string | undefined => {
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
};

// ── Status helpers ───────────────────────────────────────────────────────────
const GROUP_STATUS_CONFIG: Record<
  number,
  { label: string; color: BadgeColor }
> = {
  [GROUP_STATUS.ACTIVE]: { label: 'Active', color: 'blue' },
  [GROUP_STATUS.SUCCESS]: { label: 'Completed', color: 'green' },
  [GROUP_STATUS.FAILED]: { label: 'Failed', color: 'red' },
};

const getProgressColor = (current: number, max: number) => {
  const pct = max > 0 ? (current / max) * 100 : 0;
  if (pct >= 100) return 'bg-emerald-500';
  if (pct > 50) return 'bg-primary-500';
  return 'bg-blue-500';
};

// ── Detail Modal ─────────────────────────────────────────────────────────────
const GroupDetailModalContent: React.FC<{ groupId: string }> = ({
  groupId,
}) => {
  const { t } = useTranslation();
  const { data, loading } = useRequest(() => groupApi.getDetail(groupId));

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-gray-400">
        {t('groups.detailLoading')}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-gray-400">
        {t('groups.detailNoData')}
      </div>
    );
  }

  const statusCfg = GROUP_STATUS_CONFIG[data.groupStatus] ?? {
    label: t('groups.statusUnknown'),
    color: 'gray',
  };
  const pct =
    data.maxMembers > 0
      ? Math.min((data.currentMembers / data.maxMembers) * 100, 100)
      : 0;

  return (
    <div className="space-y-5 p-1">
      {/* Product row */}
      <div className="flex items-center gap-3 bg-gray-50 dark:bg-white/5 rounded-xl p-3 border border-gray-100 dark:border-white/10">
        <div className="w-14 h-14 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shrink-0">
          <SmartImage
            src={data.treasure?.treasureCoverImg}
            width={56}
            height={56}
            className="w-full h-full object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 dark:text-white line-clamp-1">
            {data.treasure?.treasureName ?? t('groups.detailUnknownProduct')}
          </p>
          <p className="text-xs text-gray-400 font-mono mt-0.5">
            {t('groups.detailId', { id: data.groupId.slice(-8) })}
          </p>
        </div>
        <Badge color={statusCfg.color}>{statusCfg.label}</Badge>
      </div>

      {/* Progress */}
      <div>
        <div className="flex justify-between text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
          <span className="flex items-center gap-1">
            <Users size={12} /> {t('groups.detailMembers')}
          </span>
          <span>
            {data.currentMembers} / {data.maxMembers}
          </span>
        </div>
        <div className="h-2 w-full bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              getProgressColor(data.currentMembers, data.maxMembers),
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Expire info */}
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <Timer size={12} />
        {data.expireAt
          ? t('groups.detailExpires', {
              date: format(new Date(data.expireAt), 'yyyy-MM-dd HH:mm'),
              relative: formatDistanceToNow(new Date(data.expireAt), {
                addSuffix: true,
              }),
            })
          : t('groups.detailNoExpiry')}
      </div>

      {/* Members list */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          {t('groups.detailMembersCount', { count: data.members.length })}
        </p>
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {data.members.map((m, i) => (
            <div
              key={m.user.id ?? i}
              className="flex items-center gap-2.5 p-2 rounded-lg bg-gray-50 dark:bg-white/5"
            >
              <div className="w-8 h-8 rounded-full overflow-hidden border border-gray-200 dark:border-gray-700 shrink-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center relative">
                {m.user.avatar ? (
                  <Image
                    fill
                    src={m.user.avatar}
                    className="object-cover"
                    alt=""
                    sizes="32px"
                  />
                ) : (
                  <span className="text-[10px] font-bold text-gray-400 uppercase">
                    {m.user.nickname?.slice(0, 1) ?? 'U'}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {m.user.nickname ?? t('groups.detailAnonymous')}
                </p>
                <p className="text-[10px] text-gray-400 font-mono">
                  {t('groups.detailJoined', {
                    date: format(new Date(m.joinedAt), 'MM-dd HH:mm'),
                  })}
                </p>
              </div>
              {m.isOwner === 1 && (
                <Badge color="purple">{t('groups.detailLeader')}</Badge>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
interface GroupManagementProps {
  // Phase 3: URL searchParams 驱动 filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialFormParams?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onParamsChange?: (params: Record<string, any>) => void;
}

export const GroupManagement: React.FC<GroupManagementProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType>(null);

  const normalizedInitialFormParams = useMemo(() => {
    const input = initialFormParams ?? {};
    return parseGroupsSearchParams({
      page: typeof input.page === 'string' ? input.page : undefined,
      pageSize: typeof input.pageSize === 'string' ? input.pageSize : undefined,
      treasureId:
        typeof input.treasureId === 'string' ? input.treasureId : undefined,
      status: typeof input.status === 'string' ? input.status : undefined,
      includeExpired: normalizeIncludeExpired(input.includeExpired),
    });
  }, [initialFormParams]);

  const hydrationQueryKey = useMemo(
    () => groupsListQueryKey(normalizedInitialFormParams),
    [normalizedInitialFormParams],
  );

  const handleViewDetail = useCallback(
    (record: AdminGroupItem) => {
      ModalManager.open({
        title: t('groups.detailTitle'),
        size: 'lg',
        renderChildren: () => (
          <GroupDetailModalContent groupId={record.groupId} />
        ),
      });
    },
    [t],
  );

  const columns: ProColumns<AdminGroupItem>[] = useMemo(
    () => [
      {
        title: t('groups.columnGroupProduct'),
        dataIndex: 'groupId',
        width: 260,
        render: (_, row) => (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shrink-0 bg-gray-100 dark:bg-gray-800">
              {row.treasure?.treasureCoverImg ? (
                <SmartImage
                  src={row.treasure.treasureCoverImg}
                  width={40}
                  height={40}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Users size={16} className="text-gray-400" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white line-clamp-1">
                {row.treasure?.treasureName ?? t('groups.detailUnknownProduct')}
              </p>
              <p className="text-[10px] text-gray-400 font-mono">
                #{row.groupId.slice(-8)}
              </p>
            </div>
          </div>
        ),
      },
      {
        title: t('groups.columnLeader'),
        dataIndex: 'creator',
        width: 160,
        render: (_, row) => (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full overflow-hidden border border-gray-200 dark:border-gray-700 shrink-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center relative">
              {row.creator?.avatar ? (
                <Image
                  fill
                  src={row.creator.avatar}
                  className="object-cover"
                  alt=""
                  sizes="28px"
                />
              ) : (
                <span className="text-[9px] font-bold text-gray-400 uppercase">
                  {row.creator?.nickname?.slice(0, 1) ?? 'U'}
                </span>
              )}
            </div>
            <span className="text-sm text-gray-700 dark:text-gray-300 truncate max-w-[100px]">
              {row.creator?.nickname ?? t('groups.detailAnonymous')}
            </span>
          </div>
        ),
      },
      {
        title: t('groups.columnProgress'),
        dataIndex: 'currentMembers',
        width: 160,
        render: (_, row) => {
          const pct =
            row.maxMembers > 0
              ? Math.min((row.currentMembers / row.maxMembers) * 100, 100)
              : 0;
          return (
            <div className="w-full max-w-[140px]">
              <div className="flex justify-between text-xs mb-1">
                <span className="font-bold text-gray-900 dark:text-gray-100">
                  {row.currentMembers}/{row.maxMembers}
                </span>
                <span className="text-gray-400 text-[10px]">
                  {Math.round(pct)}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full',
                    getProgressColor(row.currentMembers, row.maxMembers),
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        },
      },
      {
        title: t('groups.columnStatus'),
        dataIndex: 'groupStatus',
        width: 100,
        render: (_, row) => {
          const cfg = GROUP_STATUS_CONFIG[row.groupStatus] ?? {
            label: t('groups.statusUnknown'),
            color: 'gray',
          };
          return <Badge color={cfg.color}>{cfg.label}</Badge>;
        },
      },
      {
        title: t('groups.columnExpiresAt'),
        dataIndex: 'expireAt',
        width: 140,
        render: (_, row) =>
          row.expireAt ? (
            <div className="flex flex-col text-[11px] text-gray-500">
              <span>{format(new Date(row.expireAt), 'MM-dd HH:mm')}</span>
              <span className="text-[10px] text-gray-400">
                {formatDistanceToNow(new Date(row.expireAt), {
                  addSuffix: true,
                })}
              </span>
            </div>
          ) : (
            <span className="text-gray-300">–</span>
          ),
      },
      {
        title: t('groups.columnActions'),
        width: 80,
        valueType: 'option',
        render: (_, row) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-gray-400 hover:text-blue-600 hover:bg-blue-50"
            onClick={() => handleViewDetail(row)}
          >
            <Eye size={16} />
          </Button>
        ),
      },
    ],
    [handleViewDetail, t],
  );

  const searchSchema: FormSchema<GroupSearchForm>[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'treasureId',
        label: t('groups.searchProductId'),
        placeholder: t('groups.searchProductIdPlaceholder'),
      },
      {
        type: 'select',
        key: 'status',
        label: t('groups.searchStatus'),
        defaultValue: 'ALL',
        options: [
          { label: t('groups.searchStatusAll'), value: 'ALL' },
          {
            label: t('groups.searchStatusActive'),
            value: String(GROUP_STATUS.ACTIVE),
          },
          {
            label: t('groups.searchStatusCompleted'),
            value: String(GROUP_STATUS.SUCCESS),
          },
          {
            label: t('groups.searchStatusFailed'),
            value: String(GROUP_STATUS.FAILED),
          },
        ],
      },
      {
        type: 'select',
        key: 'includeExpired',
        label: t('groups.searchIncludeExpired'),
        defaultValue: 'false',
        options: [
          { label: t('groups.searchIncludeExpiredNo'), value: 'false' },
          { label: t('groups.searchIncludeExpiredYes'), value: 'true' },
        ],
      },
    ],
    [t],
  );

  const requestGroups = useCallback(
    async (params: GroupSearchForm & { pageSize: number; page: number }) => {
      const queryInput = parseGroupsSearchParams({
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? 20),
        treasureId:
          typeof params.treasureId === 'string' ? params.treasureId : undefined,
        status: typeof params.status === 'string' ? params.status : undefined,
        includeExpired: normalizeIncludeExpired(params.includeExpired),
      });

      const apiParams = buildGroupsListParams(
        queryInput,
      ) as AdminGroupListParams;

      try {
        const res = await groupApi.getList(apiParams);
        return { data: res.list, total: res.total, success: true };
      } catch {
        return { data: [], total: 0, success: false };
      }
    },
    [],
  );

  return (
    <div className="p-4">
      <PageHeader
        title={t('groups.pageTitle')}
        description={t('groups.pageDescription')}
      />
      <Card>
        <SmartTable<AdminGroupItem>
          ref={actionRef}
          rowKey="groupId"
          headerTitle={
            <div className="flex items-center gap-2">
              <Users className="text-primary-500" size={20} />
              <span className="font-semibold text-lg">
                {t('groups.tableTitle')}
              </span>
            </div>
          }
          columns={columns}
          request={requestGroups}
          searchSchema={searchSchema}
          defaultPageSize={20}
          initialFormParams={initialFormParams}
          onParamsChange={onParamsChange}
          enableHydration={true}
          hydrationQueryKey={hydrationQueryKey}
        />
      </Card>
    </div>
  );
};
