'use client';

import React, { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRequest } from 'ahooks';
import {
  Button,
  Form,
  FormTextField,
  FormTextareaField,
  FormSelectField,
} from '@repo/ui';
import { addressApi, regionApi } from '@/api'; //  引入 regionApi
import { useToastStore } from '@/store/useToastStore';
import { AddressResponse } from '@/type/types';

const AddressEditSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  contactName: z.string().min(1, 'Last name is required'),
  phone: z.string().min(1, 'Phone is required'),
  fullAddress: z.string().min(1, 'Full address is required'),
  isDefault: z.coerce.number(),
  // 新增地理信息 ID 校验
  provinceId: z.coerce.number().min(1, 'Province is required'),
  cityId: z.coerce.number().min(1, 'City is required'),
  barangayId: z.coerce.number().min(1, 'Barangay is required'),
});

type AddressEditFormInput = z.infer<typeof AddressEditSchema>;

interface Props {
  data?: AddressResponse;
  close: () => void;
}

export const AddressEditModal: React.FC<Props> = ({ data, close }) => {
  const addToast = useToastStore((state) => state.addToast);

  const form = useForm<AddressEditFormInput>({
    resolver: zodResolver(AddressEditSchema),
    defaultValues: {
      firstName: data?.firstName || '',
      lastName: data?.lastName || '',
      contactName: data?.contactName || '',
      phone: data?.phone || '',
      fullAddress: data?.fullAddress || '',
      isDefault: data?.isDefault || 0,
      // 初始 ID 为 0 或 undefined，稍后通过 Effect 回显
      provinceId: 0,
      cityId: 0,
      barangayId: 0,
    },
  });

  // 监听表单值变化，用于触发级联
  const provinceId = useWatch({ control: form.control, name: 'provinceId' });
  const cityId = useWatch({ control: form.control, name: 'cityId' });

  // 1. 获取省份列表
  const { data: provinces = [] } = useRequest(regionApi.provinces);

  // 2. 获取城市列表 (手动触发)
  const { run: fetchCities, data: cities = [] } = useRequest(regionApi.cities, {
    manual: true,
    onSuccess: (cityList) => {
      // 回显城市
      if (data?.city && cityList.length > 0) {
        const match = cityList.find((c) => c.cityName === data.city);
        if (match && form.getValues('cityId') !== match.cityId) {
          form.setValue('cityId', match.cityId);
        }
      }
    },
  });

  // 3. 获取区域列表 (手动触发)
  const { run: fetchBarangays, data: barangays = [] } = useRequest(
    regionApi.barangays,
    {
      manual: true,
      onSuccess: (barangayList) => {
        // 回显区域
        if (data?.barangay && barangayList.length > 0) {
          const match = barangayList.find(
            (b) => b.barangayName === data.barangay,
          );
          if (match && form.getValues('barangayId') !== match.barangayId) {
            form.setValue('barangayId', match.barangayId);
          }
        }
      },
    },
  );

  useEffect(() => {
    if (data?.province && provinces.length > 0) {
      const match = provinces.find((p) => p.provinceName === data.province);
      if (match) {
        // 设置 ID，这会触发下方的 B 逻辑
        form.setValue('provinceId', match.provinceId);
      }
    }
  }, [data?.province, provinces, form]);

  // B. 省份变化 -> 加载城市
  useEffect(() => {
    if (provinceId) {
      fetchCities(provinceId);
    } else {
      // 清空下级
    }
  }, [provinceId, fetchCities, data?.city, form]);

  // C. 城市变化 -> 加载区域
  useEffect(() => {
    if (cityId) {
      fetchBarangays(cityId);
    }
  }, [cityId, fetchBarangays, data?.barangay, form]);

  const { run: submit, loading } = useRequest(
    async (formData: AddressEditFormInput) => {
      if (data?.addressId) {
        return addressApi.updateAddress(data.addressId, formData);
      }
      return Promise.reject('Create not supported in this demo');
    },
    {
      manual: true,
      onSuccess: () => {
        addToast('success', 'Address saved successfully');
        close();
      },
      onError: (err) => {
        addToast('error', err.message || 'Failed to save');
      },
    },
  );

  return (
    <div className="space-y-4">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormTextField name="contactName" label="Contact Name" />
          </div>

          <FormTextField name="phone" label="Phone" />

          {/*  Region Selectors */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/10">
            <div className="md:col-span-3 text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">
              Area Selection
            </div>

            <FormSelectField
              name="provinceId"
              label="Province"
              placeholder="Select Province"
              options={provinces.map((p) => ({
                label: p.provinceName,
                value: String(p.provinceId), // FormSelectField 通常需要 string value
              }))}
              onOpenChange={() => {
                form.setValue('cityId', 0);
                form.setValue('barangayId', 0);
              }}
            />

            <FormSelectField
              name="cityId"
              label="City"
              placeholder="Select City"
              disabled={!provinceId}
              options={cities.map((c) => ({
                label: c.cityName,
                value: String(c.cityId),
              }))}
              onOpenChange={() => {
                form.setValue('barangayId', 0);
              }}
            />

            <FormSelectField
              name="barangayId"
              label="Barangay"
              placeholder="Select Barangay"
              disabled={!cityId}
              options={barangays.map((b) => ({
                label: b.barangayName,
                value: String(b.barangayId),
              }))}
            />
          </div>

          <FormTextareaField
            name="fullAddress"
            label="Full Address (Street, Unit, Building)"
            placeholder="e.g. Unit 123, Sunshine Condo"
          />

          <FormSelectField
            name="isDefault"
            label="Set as Default Address"
            options={[
              { label: 'No', value: '0' },
              { label: 'Yes', value: '1' },
            ]}
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-white/10">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button isLoading={loading} type="submit">
              Save Changes
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};
