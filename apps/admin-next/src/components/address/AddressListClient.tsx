'use client';

import React, { useRef, useMemo, useCallback } from 'react';
import { Button, ModalManager } from '@repo/ui';
import {
  SmartTable,
  ProColumns,
  ActionType,
} from '@/components/scaffold/SmartTable';
import { addressApi } from '@/api';
import { AddressEditModal } from '@/views/address/AddressEditModal';
import { MapPin, Edit, Trash2 } from 'lucide-react';
import { FormSchema } from '@/type/search';
import { Badge } from '@repo/ui';
import { useToastStore } from '@/store/useToastStore';
import {
  AddressResponse,
  QueryListAddressParams,
  UpdateAddress,
} from '@/type/types';
import { Card } from '@/components/UIComponents';
import {
  addressListQueryKey,
  buildAddressListParams,
  parseAddressSearchParams,
} from '@/lib/cache/address-cache';
import { useTranslation } from '@/hooks/useTranslation';

interface AddressListProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

export const AddressList: React.FC<AddressListProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
  const { t } = useTranslation();
  const actionRef = useRef<ActionType>(null);
  const addToast = useToastStore((state) => state.addToast);

  const normalizedInitialFormParams = useMemo(() => {
    const input = initialFormParams ?? {};
    return parseAddressSearchParams({
      page: typeof input.page === 'string' ? input.page : undefined,
      pageSize: typeof input.pageSize === 'string' ? input.pageSize : undefined,
      keyword: typeof input.keyword === 'string' ? input.keyword : undefined,
      userId: typeof input.userId === 'string' ? input.userId : undefined,
      province: typeof input.province === 'string' ? input.province : undefined,
      phone: typeof input.phone === 'string' ? input.phone : undefined,
    });
  }, [initialFormParams]);

  const hydrationQueryKey = useMemo(
    () => addressListQueryKey(normalizedInitialFormParams),
    [normalizedInitialFormParams],
  );

  const handleEdit = useCallback(
    (record?: UpdateAddress) => {
      ModalManager.open({
        title: record ? t('address_modalEdit') : t('address_modalCreate'),
        renderChildren: ({ close }) => (
          <AddressEditModal
            data={record as AddressResponse}
            tAction={t}
            closeAction={() => {
              close();
              actionRef.current?.reload();
            }}
          />
        ),
      });
    },
    [t],
  );

  const handleDelete = useCallback(
    (record: AddressResponse) => {
      ModalManager.open({
        title: t('address_modalDelete'),
        renderChildren: () => (
          <div>
            {t('address_deleteConfirm', {
              name: record.firstName + ' ' + record.lastName,
            })}
          </div>
        ),
        onConfirm: async () => {
          await addressApi.deleteAddress(record.addressId);
          addToast('success', t('address_deleteSuccess'));
          actionRef.current?.reload();
        },
      });
    },
    [addToast, t],
  );

  const columns: ProColumns<AddressResponse>[] = useMemo(
    () => [
      {
        title: t('address_columnUserInfo'),
        dataIndex: 'userId',
        render: (_, row) => (
          <div>
            <div className="font-medium text-gray-900 dark:text-gray-200">
              {row.userNickname || t('address_unknownUser')}
            </div>
            <div className="text-xs text-gray-500 font-mono">
              ID: {row.userId}
            </div>
          </div>
        ),
      },
      {
        title: t('address_columnRecipient'),
        dataIndex: 'contactName',
        render: (_, row) => (
          <div>
            <div className="font-medium">{row.contactName}</div>
            <div className="text-xs text-gray-500">{row.phone}</div>
          </div>
        ),
      },
      {
        title: t('address_columnRegion'),
        dataIndex: 'province',
        render: (_, row) => (
          <div className="text-sm">
            <div>
              {row.province}, {row.city}
            </div>
            <div className="text-xs text-gray-400">{row.barangay}</div>
          </div>
        ),
      },
      {
        title: t('address_columnFullAddress'),
        dataIndex: 'fullAddress',
        width: 250,
        render: (dom) => <div className="break-words text-sm">{dom}</div>,
      },
      {
        title: t('address_columnTag'),
        dataIndex: 'label',
        render: (dom, row) => (
          <div className="flex gap-1">
            {row.isDefault === 1 && (
              <Badge variant="default" className="bg-primary-600">
                {t('address_badgeDefault')}
              </Badge>
            )}
            {dom && <Badge variant="outline">{dom}</Badge>}
          </div>
        ),
      },
      {
        title: t('address_columnCreatedAt'),
        dataIndex: 'createdAt',
        valueType: 'dateTime',
        render: (dom) => <span className="text-xs text-gray-500">{dom}</span>,
      },
      {
        title: t('address_columnAction'),
        valueType: 'option',
        width: 140,
        render: (_, row) => (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleEdit(row)}>
              <Edit size={14} />
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleDelete(row)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ),
      },
    ],
    [handleEdit, handleDelete, t],
  );

  const searchSchema: FormSchema[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'keyword',
        label: t('address_searchKeyword'),
        placeholder: t('address_searchKeywordPlaceholder'),
      },
      {
        type: 'input',
        key: 'userId',
        label: t('address_searchUserId'),
        placeholder: t('address_searchUserIdPlaceholder'),
      },
      {
        type: 'input',
        key: 'province',
        label: t('address_searchProvince'),
        placeholder: t('address_searchProvincePlaceholder'),
      },
    ],
    [t],
  );

  const requestAddress = useCallback(async (params: QueryListAddressParams) => {
    const input = params as Record<string, unknown>;
    const queryInput = parseAddressSearchParams({
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 10),
      keyword: typeof input.keyword === 'string' ? input.keyword : undefined,
      userId: typeof input.userId === 'string' ? input.userId : undefined,
      province: typeof input.province === 'string' ? input.province : undefined,
      phone: typeof input.phone === 'string' ? input.phone : undefined,
    });

    const res = await addressApi.list(
      buildAddressListParams(queryInput) as QueryListAddressParams,
    );
    return {
      data: res.list,
      total: res.total,
      success: true,
    };
  }, []);

  return (
    <Card>
      <div className="p-4">
        <SmartTable<AddressResponse>
          headerTitle={
            <div className="flex items-center gap-2">
              <MapPin className="text-primary-500" size={20} />
              <span>{t('address_pageTitle')}</span>
            </div>
          }
          rowKey="addressId"
          ref={actionRef}
          columns={columns}
          searchSchema={searchSchema}
          request={requestAddress}
          initialFormParams={normalizedInitialFormParams}
          onParamsChange={onParamsChange}
          enableHydration={true}
          hydrationQueryKey={hydrationQueryKey}
        />
      </div>
    </Card>
  );
};
