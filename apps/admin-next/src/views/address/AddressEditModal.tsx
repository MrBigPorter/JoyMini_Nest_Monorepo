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
import { addressApi, regionApi } from '@/api';
import { useToastStore } from '@/store/useToastStore';
import { AddressResponse } from '@/type/types';
import type { TFunc } from '@/hooks/useTranslation';

const createAddressEditSchema = (tAction: (key: string) => string) =>
  z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    contactName: z
      .string()
      .min(1, tAction('address_validation_contactNameRequired')),
    phone: z.string().min(1, tAction('address_validation_phoneRequired')),
    fullAddress: z
      .string()
      .min(1, tAction('address_validation_fullAddressRequired')),
    isDefault: z.coerce.number(),
    provinceId: z.coerce
      .number()
      .min(1, tAction('address_validation_provinceRequired')),
    cityId: z.coerce
      .number()
      .min(1, tAction('address_validation_cityRequired')),
    barangayId: z.coerce
      .number()
      .min(1, tAction('address_validation_barangayRequired')),
  });

type AddressEditFormInput = z.infer<ReturnType<typeof createAddressEditSchema>>;

interface Props {
  data?: AddressResponse;
  closeAction: () => void;
  tAction: TFunc;
}

export const AddressEditModal: React.FC<Props> = ({
  data,
  closeAction,
  tAction,
}) => {
  const addToast = useToastStore((state) => state.addToast);

  const form = useForm<AddressEditFormInput>({
    resolver: zodResolver(createAddressEditSchema(tAction)),
    defaultValues: {
      firstName: data?.firstName || '',
      lastName: data?.lastName || '',
      contactName: data?.contactName || '',
      phone: data?.phone || '',
      fullAddress: data?.fullAddress || '',
      isDefault: data?.isDefault || 0,
      provinceId: 0,
      cityId: 0,
      barangayId: 0,
    },
  });

  const provinceId = useWatch({ control: form.control, name: 'provinceId' });
  const cityId = useWatch({ control: form.control, name: 'cityId' });

  const { data: provinces = [] } = useRequest(regionApi.provinces);

  const { run: fetchCities, data: cities = [] } = useRequest(regionApi.cities, {
    manual: true,
    onSuccess: (cityList) => {
      if (data?.city && cityList.length > 0) {
        const match = cityList.find((c) => c.cityName === data.city);
        if (match && form.getValues('cityId') !== match.cityId) {
          form.setValue('cityId', match.cityId);
        }
      }
    },
  });

  const { run: fetchBarangays, data: barangays = [] } = useRequest(
    regionApi.barangays,
    {
      manual: true,
      onSuccess: (barangayList) => {
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
        form.setValue('provinceId', match.provinceId);
      }
    }
  }, [data?.province, provinces, form]);

  useEffect(() => {
    if (provinceId) {
      fetchCities(provinceId);
    }
  }, [provinceId, fetchCities, data?.city, form]);

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
        addToast('success', tAction('address_savedSuccess'));
        closeAction();
      },
      onError: (err) => {
        addToast('error', err.message || tAction('address_saveFailed'));
      },
    },
  );

  return (
    <div className="space-y-4">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormTextField
              name="contactName"
              label={tAction('address_formContactName')}
            />
          </div>

          <FormTextField name="phone" label={tAction('address_formPhone')} />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/10">
            <div className="md:col-span-3 text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">
              {tAction('address_areaSelection')}
            </div>

            <FormSelectField
              name="provinceId"
              label={tAction('address_formProvince')}
              placeholder={tAction('address_formProvincePlaceholder')}
              options={provinces.map((p) => ({
                label: p.provinceName,
                value: String(p.provinceId),
              }))}
              onOpenChange={() => {
                form.setValue('cityId', 0);
                form.setValue('barangayId', 0);
              }}
            />

            <FormSelectField
              name="cityId"
              label={tAction('address_formCity')}
              placeholder={tAction('address_formCityPlaceholder')}
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
              label={tAction('address_formBarangay')}
              placeholder={tAction('address_formBarangayPlaceholder')}
              disabled={!cityId}
              options={barangays.map((b) => ({
                label: b.barangayName,
                value: String(b.barangayId),
              }))}
            />
          </div>

          <FormTextareaField
            name="fullAddress"
            label={tAction('address_formFullAddress')}
            placeholder={tAction('address_formFullAddressPlaceholder')}
          />

          <FormSelectField
            name="isDefault"
            label={tAction('address_formIsDefault')}
            options={[
              { label: tAction('address_optionNo'), value: '0' },
              { label: tAction('address_optionYes'), value: '1' },
            ]}
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-white/10">
            <Button type="button" variant="outline" onClick={closeAction}>
              {tAction('address_cancel')}
            </Button>
            <Button isLoading={loading} type="submit">
              {tAction('address_saveChanges')}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};
