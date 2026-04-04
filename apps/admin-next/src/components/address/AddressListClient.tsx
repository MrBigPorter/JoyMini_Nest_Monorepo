'use client';

import React, { useRef, useMemo, useCallback } from 'react';
import { Button, ModalManager } from '@repo/ui';
import {
  SmartTable,
  ProColumns,
  ActionType,
} from '@/components/scaffold/SmartTable';
import { addressApi } from '@/api'; // 假设你有这个 API 定义
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

interface AddressListProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

export const AddressList: React.FC<AddressListProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
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

  // 打开编辑/新增弹窗
  const handleEdit = useCallback((record?: UpdateAddress) => {
    ModalManager.open({
      title: record ? 'Edit Address' : 'Create New Address',
      renderChildren: ({ close }) => (
        <AddressEditModal
          data={record as AddressResponse}
          close={() => {
            close();
            actionRef.current?.reload();
          }}
        />
      ),
    });
  }, []);

  // 删除地址
  const handleDelete = useCallback(
    (record: AddressResponse) => {
      ModalManager.open({
        title: 'Delete Address',
        renderChildren: () => (
          <div>
            Are you sure you want to delete the address for {record.firstName}
            {record.lastName}?
          </div>
        ),
        onConfirm: async () => {
          await addressApi.deleteAddress(record.addressId);
          addToast('success', 'Address deleted successfully');
          actionRef.current?.reload();
        },
      });
    },
    [addToast],
  );

  // 表格列定义
  const columns: ProColumns<AddressResponse>[] = useMemo(
    () => [
      {
        title: 'User Info',
        dataIndex: 'userId',
        render: (_, row) => (
          <div>
            <div className="font-medium text-gray-900 dark:text-gray-200">
              {row.userNickname || 'Unknown'}
            </div>
            <div className="text-xs text-gray-500 font-mono">
              ID: {row.userId}
            </div>
          </div>
        ),
      },
      {
        title: 'Recipient',
        dataIndex: 'contactName',
        render: (_, row) => (
          <div>
            <div className="font-medium">{row.contactName}</div>
            <div className="text-xs text-gray-500">{row.phone}</div>
          </div>
        ),
      },
      {
        title: 'Region',
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
        title: 'Full Address',
        dataIndex: 'fullAddress',
        width: 250,
        render: (dom) => <div className="break-words text-sm">{dom}</div>,
      },
      {
        title: 'Tag',
        dataIndex: 'label',
        render: (dom, row) => (
          <div className="flex gap-1">
            {row.isDefault === 1 && (
              <Badge variant="default" className="bg-primary-600">
                Default
              </Badge>
            )}
            {dom && <Badge variant="outline">{dom}</Badge>}
          </div>
        ),
      },
      {
        title: 'Created At',
        dataIndex: 'createdAt',
        valueType: 'dateTime',
        render: (dom) => <span className="text-xs text-gray-500">{dom}</span>,
      },
      {
        title: 'Action',
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
    [handleEdit, handleDelete],
  );

  // 搜索栏配置
  const searchSchema: FormSchema[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'keyword',
        label: 'Keyword',
        placeholder: 'Name / Phone',
      },
      {
        type: 'input',
        key: 'userId',
        label: 'User ID',
        placeholder: 'Exact User ID',
      },
      {
        type: 'input',
        key: 'province',
        label: 'Province',
        placeholder: 'Province Name',
      },
    ],
    [],
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
              <span>Address Management</span>
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
