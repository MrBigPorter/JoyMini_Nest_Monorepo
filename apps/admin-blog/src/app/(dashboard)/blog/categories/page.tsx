'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FolderTree, Edit, Trash2 } from 'lucide-react';
import { useToastStore } from '@/store/useToastStore';
import { Card, Skeleton } from '@/components/UIComponents';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { blogApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { SmartTable } from '@/components/scaffold/SmartTable';
import { Button, ModalManager } from '@repo/ui';
import { BlogCategoryModal } from '@/views/blog/BlogCategoryModal';
import { renderLocalizedText } from '@/utils/localizedText';
import type {
  ProColumns,
  ActionType,
} from '@/components/scaffold/SmartTable/types';
import { useTranslation } from '@/hooks/useTranslation';
import type { FormSchema } from '@/type/search';

export default function CategoriesPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [editingCategory, setEditingCategory] = useState<null | {
    id: string;
    name: Record<string, string | undefined> | string;
    slug: string;
    description?: Record<string, string | undefined> | string;
  }>(null);
  const { addToast } = useToastStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  const actionRef = useRef<ActionType>(null);
  const { t: globalT, lang } = useTranslation();

  const t = (key: string, params?: Record<string, string | number>) =>
    globalT(`blog_categories_${key}`, params);

  useEffect(() => {
    // Clear initial loading state after SmartTable starts its own loading
    setInitialLoading(false);
  }, []);

  // 删除分类 mutation
  const deleteCategoryMutation = useMutation({
    mutationFn: (categoryId: string) => blogApi.deleteCategory(categoryId),
    onSuccess: () => {
      addToast('success', t('categoryDeleted'));
      actionRef.current?.reload();
    },
    onError: (error: any) => {
      console.error('Failed to delete category:', error);
      addToast('error', t('deleteFailed'));
    },
  });

  // SmartTable列定义
  const handleDeleteCategory = async (category: any) => {
    ModalManager.open({
      title: t('deleteCategory'),
      confirmText: t('deleteConfirm'),
      cancelText: t('cancel'),
      renderChildren: (
        <div className="space-y-3">
          <p>
            {t('deleteConfirmText', {
              name: renderLocalizedText(category.name, lang, category.id),
            })}
          </p>

          <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">
            <div className="font-semibold mb-1">
              {t('actionCannotBeUndone')}
            </div>
            {category.articleCount > 0 && (
              <div className="mt-2">
                {t('thisCategoryContains', { count: category.articleCount })}
                <br />
                {t('articlesWillBeMoved')}
              </div>
            )}
          </div>

          <div className="text-xs text-gray-500 mt-2 bg-gray-50 p-2 rounded">
            <div className="font-medium">{t('categoryDetails')}</div>
            <div>
              {t('slug')} <code>/{category.slug}</code>
            </div>
            {category.description && (
              <div className="mt-1">
                {t('description')}:{' '}
                {renderLocalizedText(
                  category.description,
                  lang,
                  t('noDescription'),
                )}
              </div>
            )}
          </div>
        </div>
      ),
      onConfirm: () => {
        deleteCategoryMutation.mutate(category.id);
      },
    });
  };

  const handleEditCategory = (category: any) => {
    setEditingCategory({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
    });
    setIsModalOpen(true);
  };

  const categoryColumns: ProColumns[] = [
    {
      dataIndex: 'name',
      title: t('name'),
      render: (dom, category: any) => (
        <div className="flex items-center">
          <FolderTree className="mr-2 h-4 w-4 text-muted-foreground" />
          <div className="font-medium">
            {renderLocalizedText(category.name)}
          </div>
        </div>
      ),
    },
    {
      dataIndex: 'slug',
      title: t('slug'),
      render: (dom, category: any) => (
        <code className="text-sm bg-muted px-2 py-1 rounded">
          /{category.slug}
        </code>
      ),
    },
    {
      dataIndex: 'description',
      title: t('description'),
      render: (dom, category: any) => (
        <p className="text-sm text-muted-foreground max-w-md truncate">
          {renderLocalizedText(category.description, lang, t('noDescription'))}
        </p>
      ),
    },
    {
      dataIndex: 'articleCount',
      title: t('articles'),
      render: (dom, category: any) => (
        <span className="px-2 py-1 text-xs rounded-full bg-primary/10 text-primary">
          {category.articleCount || 0} {t('articles')}
        </span>
      ),
    },
    {
      dataIndex: 'createdAt',
      title: t('created'),
      render: (dom, category: any) => (
        <div className="text-sm text-muted-foreground">
          {category.createdAt}
        </div>
      ),
    },
    {
      dataIndex: 'actions',
      title: t('actions'),
      render: (dom, category: any) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleEditCategory(category)}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDeleteCategory(category)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  // 搜索表单配置
  const searchSchema: FormSchema[] = [
    {
      type: 'input',
      key: 'search',
      label: t('search'),
      placeholder: t('searchPlaceholder'),
    },
  ];

  // 请求分类数据
  const requestCategories = useCallback(async (params: any) => {
    console.log('requestCategories called with params:', params);
    try {
      const response = await blogApi.getCategories({
        search: params.search,
      });
      console.log('requestCategories response:', response);
      return {
        data: response.list || [],
        total: response.list?.length || 0,
        success: true,
      };
    } catch (error) {
      console.error('Failed to fetch categories:', error);
      return { data: [], total: 0, success: false };
    }
  }, []);

  // Show initial loading skeleton
  if (initialLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('pageTitle')} description={t('pageDescription')} />
        <Card>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton variant="text" className="w-32 h-6" />
              <Skeleton variant="text" className="w-24 h-8" />
            </div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-4 items-center border-b pb-3">
                <Skeleton variant="text" className="w-8 h-8" />
                <div className="flex-1 space-y-1">
                  <Skeleton variant="text" className="w-1/2" />
                  <Skeleton variant="text" className="w-1/3" />
                </div>
                <Skeleton variant="text" className="w-16 h-6" />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="p-4 space-y-2">
            <Skeleton variant="text" className="w-40" />
            <Skeleton variant="text" />
            <Skeleton variant="text" className="w-5/6" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        breadcrumbs={[globalT('content'), globalT('breadcrumbCategories')]}
        buttonText={t('newCategory')}
        buttonOnClick={() => {
          setEditingCategory(null);
          setIsModalOpen(true);
        }}
      />

      <BlogCategoryModal
        isOpen={isModalOpen}
        onCloseAction={() => setIsModalOpen(false)}
        editingCategory={editingCategory}
        onSuccessAction={() => {
          actionRef.current?.reload();
        }}
      />

      {/* Categories Table */}
      <Card title={t('categoryList')}>
        <SmartTable
          ref={actionRef}
          rowKey="id"
          columns={categoryColumns}
          request={requestCategories}
          searchSchema={searchSchema}
          headerTitle={
            <div className="flex items-center gap-2">
              <FolderTree className="text-primary-500" size={20} />
              <span className="font-semibold text-lg">{t('categoryList')}</span>
            </div>
          }
        />
      </Card>

      {/* Usage Tips */}
      <Card title={t('categoryUsageTips')}>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>{t('tip1')}</span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>{t('tip2')}</span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>{t('tip3')}</span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>{t('tip4')}</span>
          </li>
        </ul>
      </Card>
    </div>
  );
}
