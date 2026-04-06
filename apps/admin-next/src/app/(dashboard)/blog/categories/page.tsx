'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { FolderTree, Edit, Trash2 } from 'lucide-react';
import { useToastStore } from '@/store/useToastStore';
import { Card } from '@/components/UIComponents';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { blogApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { SmartTable } from '@/components/scaffold/SmartTable';
import { Button, ModalManager } from '@repo/ui';
import { BlogCategoryModal } from '@/views/blog/BlogCategoryModal';
import type {
  ProColumns,
  ActionType,
} from '@/components/scaffold/SmartTable/types';
import type { FormSchema } from '@/type/search';

export default function CategoriesPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<null | {
    id: string;
    name: string;
    slug: string;
    description?: string;
  }>(null);
  const { addToast } = useToastStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  const actionRef = useRef<ActionType>(null);

  // 删除分类 mutation
  const deleteCategoryMutation = useMutation({
    mutationFn: (categoryId: string) => blogApi.deleteCategory(categoryId),
    onSuccess: () => {
      addToast('success', 'Category deleted successfully');
      actionRef.current?.reload();
    },
    onError: (error: any) => {
      console.error('Failed to delete category:', error);
      addToast('error', 'Failed to delete category');
    },
  });

  // SmartTable列定义
  const handleDeleteCategory = async (category: any) => {
    ModalManager.open({
      title: 'Delete Category?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      renderChildren: (
        <div className="space-y-3">
          <p>
            Are you sure you want to delete category{' '}
            <span className="font-bold text-primary-600">{category.name}</span>?
          </p>

          <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">
            <div className="font-semibold mb-1">
              ⚠️ This action cannot be undone.
            </div>
            {category.articleCount > 0 && (
              <div className="mt-2">
                This category contains{' '}
                <span className="font-bold">{category.articleCount}</span>{' '}
                articles.
                <br />
                These articles will be moved to &#34;Uncategorized&#34;.
              </div>
            )}
          </div>

          <div className="text-xs text-gray-500 mt-2 bg-gray-50 p-2 rounded">
            <div className="font-medium">Category Details:</div>
            <div>
              Slug: <code>/{category.slug}</code>
            </div>
            {category.description && (
              <div className="mt-1">Description: {category.description}</div>
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
      title: 'Name',
      render: (dom, category: any) => (
        <div className="flex items-center">
          <FolderTree className="mr-2 h-4 w-4 text-muted-foreground" />
          <div className="font-medium">{category.name}</div>
        </div>
      ),
    },
    {
      dataIndex: 'slug',
      title: 'Slug',
      render: (dom, category: any) => (
        <code className="text-sm bg-muted px-2 py-1 rounded">
          /{category.slug}
        </code>
      ),
    },
    {
      dataIndex: 'description',
      title: 'Description',
      render: (dom, category: any) => (
        <p className="text-sm text-muted-foreground max-w-md truncate">
          {category.description || 'No description'}
        </p>
      ),
    },
    {
      dataIndex: 'articleCount',
      title: 'Articles',
      render: (dom, category: any) => (
        <span className="px-2 py-1 text-xs rounded-full bg-primary/10 text-primary">
          {category.articleCount || 0} articles
        </span>
      ),
    },
    {
      dataIndex: 'createdAt',
      title: 'Created',
      render: (dom, category: any) => (
        <div className="text-sm text-muted-foreground">
          {category.createdAt}
        </div>
      ),
    },
    {
      dataIndex: 'actions',
      title: 'Actions',
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
      label: 'Search',
      placeholder: 'Search by name or description...',
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Category Management"
        description="Manage blog categories for organizing articles"
        showBackButton={true}
        onBack={() => router.push('/blog')}
        breadcrumbs={['Blog', 'Categories']}
        buttonText="New Category"
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
      <Card title="Category List">
        <SmartTable
          ref={actionRef}
          rowKey="id"
          columns={categoryColumns}
          request={requestCategories}
          searchSchema={searchSchema}
          headerTitle={
            <div className="flex items-center gap-2">
              <FolderTree className="text-primary-500" size={20} />
              <span className="font-semibold text-lg">Categories</span>
            </div>
          }
        />
      </Card>

      {/* Usage Tips */}
      <Card title="Category Usage Tips">
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>Categories help organize articles into logical groups</span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>Each article can belong to only one category</span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>
              URL slugs should be lowercase with hyphens
              (e.g.,&#34;web-development&#34;)
            </span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>
              Categories with articles cannot be deleted - move articles first
            </span>
          </li>
        </ul>
      </Card>
    </div>
  );
}
