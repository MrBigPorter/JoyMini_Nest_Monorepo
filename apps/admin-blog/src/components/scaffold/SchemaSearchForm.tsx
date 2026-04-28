'use client';

import { useForm } from 'react-hook-form';
import { Search, RotateCcw } from 'lucide-react';
import {
  Button,
  Form, // 需要从 UI 库引入 Form Wrapper
  FormDateField,
  FormSelectField,
  FormTextField,
} from '@repo/ui';
import { SearchFieldSchema } from '@/type/search';
import { useMemo, useCallback } from 'react';

// 泛型 T 限制为对象
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Props<T extends Record<string, any>> {
  schema: SearchFieldSchema<T>[];
  initialValues?: Partial<T>;
  onSearch: (values: T) => void;
  onReset?: () => void;
  loading?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SchemaSearchForm = <T extends Record<string, any>>({
  schema,
  initialValues = {},
  onSearch,
  onReset,
  loading,
}: Props<T>) => {
  const cleanValues = useCallback((values: T) => {
    return Object.fromEntries(
      Object.entries(values).filter(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ([_, v]) => v !== '' && v !== undefined && v !== null && v !== 'ALL',
      ),
    ) as T;
  }, []);

  // 1. 生成默认值对象
  const defaultValues = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaults: any = { ...initialValues };
    schema.forEach((field) => {
      if (defaults[field.key] === undefined) {
        defaults[field.key] = field.defaultValue ?? '';
      }
    });
    return defaults;
  }, [schema, initialValues]);

  // reset 应回到 schema 默认值，而不是回到 URL 初始筛选
  const resetValues = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaults: any = {};
    schema.forEach((field) => {
      defaults[field.key] = field.defaultValue ?? '';
    });
    return defaults as T;
  }, [schema]);

  // 2. 使用 React Hook Form 接管状态
  const form = useForm<T>({
    defaultValues,
  });

  // 3. 搜索处理
  const onSubmit = (values: T) => {
    onSearch(cleanValues(values));
  };

  // 4. 重置处理
  const handleReset = () => {
    form.reset(resetValues); // 重置到 schema 默认值
    onReset?.();
    onSearch(cleanValues(resetValues));
  };

  // 5. 渲染字段
  const renderField = (field: SearchFieldSchema<T>) => {
    switch (field.type) {
      case 'input':
        return (
          <FormTextField
            autoComplete="off"
            key={String(field.key)}
            name={String(field.key)}
            label={field.label}
            placeholder={field.placeholder}
          />
        );
      case 'select':
        return (
          <FormSelectField
            key={String(field.key)}
            name={String(field.key)}
            label={field.label}
            options={field.options || []}
            placeholder={field.placeholder || 'Select...'}
          />
        );
      case 'date':
        return (
          <FormDateField
            key={String(field.key)}
            name={String(field.key)}
            label={field.label}
            showTime={field.showTime || false}
            mode={field.mode || 'single'}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="p-4 mb-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-white/10">
      {/* 必须包裹在 Form 组件中，以便 FormTextField 等组件能获取上下文 */}
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 items-end"
        >
          {schema.map((field) => (
            <div key={String(field.key)} className={field.className}>
              {renderField(field)}
            </div>
          ))}

          <div className="flex gap-2 pb-1">
            <Button type="submit" isLoading={loading}>
              <Search size={16} className="mr-2" /> Search
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={handleReset}
              aria-label="Reset"
            >
              <RotateCcw size={16} />
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};
