'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToastStore } from '@/store/useToastStore';
import { actSectionApi } from '@/api';
import { z } from 'zod';
import {
  Button,
  Form,
  FormCheckboxField,
  FormDateField,
  FormSelectField,
  FormTextField,
} from '@repo/ui';
import { useRequest } from 'ahooks';
import { ActSectionSchema } from '@/schema/ActSectionSchema';
import { ActSection } from '@/type/types';
import React, { useEffect } from 'react';
import type { TFunc } from '@/hooks/useTranslation';

type ActSectionFormInputs = z.infer<typeof ActSectionSchema>;

interface Props {
  close: () => void;
  confirm: () => void;
  editingData?: ActSection | null;
  t: TFunc;
}

export const ProductSelectorModal: React.FC<Props> = ({
  close,
  confirm,
  editingData,
  t,
}) => {
  const addToast = useToastStore((s) => s.addToast);

  const { run: creatActSection, loading } = useRequest(actSectionApi.create, {
    manual: true,
    onSuccess: () => {
      addToast('success', t('actSections.toastCreated'));
      confirm();
    },
  });

  const { run: updateActSection, loading: updateLoading } = useRequest(
    actSectionApi.update,
    {
      manual: true,
      onSuccess: () => {
        addToast('success', t('actSections.toastUpdated'));
        confirm();
      },
    },
  );

  const form = useForm<ActSectionFormInputs>({
    resolver: zodResolver(ActSectionSchema),
    defaultValues: {
      title: '',
      key: '',
      imgStyleType: 0,
      limit: 0,
      startAt: undefined,
      endAt: undefined,
      status: 1,
    },
  });

  const onSubmit = async (values: ActSectionFormInputs) => {
    try {
      if (editingData) {
        updateActSection(editingData.id, values);
        return;
      }
      creatActSection(values);
    } catch {
      addToast('error', t('actSections.toastSaveFailed'));
    }
  };

  useEffect(() => {
    if (editingData) {
      form.reset(
        {
          title: editingData.title,
          key: editingData.key,
          imgStyleType: editingData.imgStyleType,
          limit: editingData.limit,
          startAt: editingData.startAt
            ? new Date(editingData.startAt)
            : undefined,
          endAt: editingData.endAt ? new Date(editingData.endAt) : undefined,
          status: editingData.status,
        },
        {
          keepDirtyValues: false,
          keepTouched: false,
          keepErrors: false,
        },
      );
    }
  }, [editingData, form]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormTextField
              required
              autoComplete="off"
              name="title"
              label={t('actSections.formTitle')}
              placeholder={t('actSections.formTitlePlaceholder')}
            />
            <FormTextField
              required
              name="key"
              label={t('actSections.formKey')}
              autoComplete="off"
              placeholder={t('actSections.formKeyPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormSelectField
              required
              name="imgStyleType"
              label={t('actSections.formStyleType')}
              numeric={true}
              options={[
                { label: t('actSections.styleType0'), value: '0' },
                { label: t('actSections.styleType1'), value: '1' },
                {
                  label: t('actSections.styleType2'),
                  value: '2',
                },
                {
                  label: t('actSections.styleType3'),
                  value: '3',
                },
                {
                  label: t('actSections.styleType4'),
                  value: '4',
                },
              ]}
            />
            <FormTextField
              required
              name="limit"
              label={t('actSections.formLimit')}
              type="number"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormDateField
              name="startAt"
              label={t('actSections.formStartTime')}
            />
            <FormDateField name="endAt" label={t('actSections.formEndTime')} />
          </div>

          <div className="flex flex-col">
            <FormCheckboxField
              name="status"
              label={t('actSections.formEnable')}
            />
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={close}>
              {t('actSections.cancel')}
            </Button>
            <Button isLoading={loading || updateLoading} type="submit">
              {editingData
                ? t('actSections.updateSection')
                : t('actSections.createSection')}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
};
