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

type ActSectionFormInputs = z.infer<typeof ActSectionSchema>;

interface Props {
  close: () => void;
  confirm: () => void;
  editingData?: ActSection | null;
}

export const ProductSelectorModal: React.FC<Props> = ({
  close,
  confirm,
  editingData,
}) => {
  const addToast = useToastStore((s) => s.addToast);

  const { run: creatActSection, loading } = useRequest(actSectionApi.create, {
    manual: true,
    onSuccess: () => {
      addToast('success', 'Section created successfully');
      confirm();
    },
  });

  const { run: updateActSection, loading: updateLoading } = useRequest(
    actSectionApi.update,
    {
      manual: true,
      onSuccess: () => {
        addToast('success', 'Section updated successfully');
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
      addToast('error', 'Failed to save product');
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
              label="Title"
              placeholder="e.g. New Arrival"
            />
            <FormTextField
              required
              name="key"
              label="Key (Unique)"
              autoComplete="off"
              placeholder="e.g. Weekly Best"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormSelectField
              required
              name="imgStyleType"
              label="Style Type"
              numeric={true}
              options={[
                { label: 'Ending (Horizontal Scroll)', value: '1' },
                {
                  label: 'Special Area (List w/ Progress)',
                  value: '2',
                },
                {
                  label: 'Home Future (Vertical Big Cards)',
                  value: '3',
                },
                {
                  label: 'Recommendation (Grid 2 Columns)',
                  value: '4',
                },
              ]}
            />
            <FormTextField required name="limit" label="Limit" type="number" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormDateField name="startAt" label="Start Time" />
            <FormDateField name="endAt" label="End Time" />
          </div>

          <div className="flex flex-col">
            <FormCheckboxField name="status" label="Enable this section" />
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button isLoading={loading || updateLoading} type="submit">
              {editingData ? 'Update Section' : 'Create Section'}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
};
