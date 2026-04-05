'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  FolderTree,
  Plus,
  Search,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Filter,
  Download,
} from 'lucide-react';
import { useToastStore } from '@/store/useToastStore';
import { Card } from '@/components/UIComponents';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { blogApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { SmartTable } from '@/components/scaffold/SmartTable';
import { Pagination } from '@/components/scaffold/Pagination';
import { Button } from '@repo/ui';
import { Modal } from '@/components/UIComponents';
import type { ProColumns } from '@/components/scaffold/SmartTable/types';

export default function CategoriesPage() {
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategorySlug, setNewCategorySlug] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const { addToast } = useToastStore();
  const router = useRouter();
  const queryClient = useQueryClient();

  // 查询分类列表
  const {
    data: categoriesData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['blog', 'categories'],
    queryFn: async () => {
      const response = await blogApi.getCategories();
      return response;
    },
  });

  // 从响应中提取数据
  const categories = categoriesData?.list || [];

  // 错误处理
  useEffect(() => {
    if (error) {
      console.error('Failed to fetch categories:', error);
      addToast('error', 'Failed to load categories');
    }
  }, [error, addToast]);

  // 删除分类 mutation
  const deleteCategoryMutation = useMutation({
    mutationFn: (categoryId: string) => blogApi.deleteCategory(categoryId),
    onSuccess: () => {
      addToast('success', 'Category deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['blog', 'categories'] });
    },
    onError: (error: any) => {
      console.error('Failed to delete category:', error);
      addToast('error', 'Failed to delete category');
    },
  });

  // SmartTable列定义
  const handleDeleteCategory = async (categoryId: string) => {
    if (
      !window.confirm(
        'Are you sure you want to delete this category? This action cannot be undone.',
      )
    ) {
      return;
    }
    deleteCategoryMutation.mutate(categoryId);
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
          <Button variant="outline" size="sm">
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDeleteCategory(category.id)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const filteredCategories = categories.filter((category) => {
    return !(
      search &&
      !category.name.toLowerCase().includes(search.toLowerCase()) &&
      !category.description.toLowerCase().includes(search.toLowerCase())
    );
  });

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await blogApi.createCategory({
        name: newCategoryName,
        slug: newCategorySlug,
        description: newCategoryDescription,
      });
      addToast('success', 'Category created successfully');
      setNewCategoryName('');
      setNewCategorySlug('');
      setNewCategoryDescription('');
      setIsCreating(false);
      queryClient.invalidateQueries({ queryKey: ['blog', 'categories'] }); // Refresh the list
    } catch (error) {
      console.error('Failed to create category:', error);
      addToast('error', 'Failed to create category');
    }
  };

  if (isLoading && categories.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">
            Loading categories...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Category Management"
        description="Manage blog categories for organizing articles"
        showBackButton={true}
        onBack={() => router.push('/blog')}
        breadcrumbs={['Blog', 'Categories']}
        buttonText="New Category"
        buttonOnClick={() => setIsCreating(true)}
      />

      {/* Create Category Form */}
      {isCreating && (
        <Card title="Create New Category">
          <form onSubmit={handleCreateCategory} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">
                  Category Name *
                </label>
                <input
                  id="name"
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Enter category name"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 dark:text-white placeholder-gray-400 dark:placeholder-gray-600"
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="slug" className="text-sm font-medium">
                  URL Slug *
                </label>
                <input
                  id="slug"
                  type="text"
                  value={newCategorySlug}
                  onChange={(e) => setNewCategorySlug(e.target.value)}
                  placeholder="Enter URL slug"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 dark:text-white placeholder-gray-400 dark:placeholder-gray-600"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="description" className="text-sm font-medium">
                Description
              </label>
              <textarea
                id="description"
                value={newCategoryDescription}
                onChange={(e) => setNewCategoryDescription(e.target.value)}
                placeholder="Enter category description (optional)"
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 dark:text-white placeholder-gray-400 dark:placeholder-gray-600"
              />
            </div>
            <div className="flex items-center justify-end space-x-4 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreating(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newCategoryName || !newCategorySlug}
              >
                Create Category
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Search */}
      <Card>
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="flex-1 w-full">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search categories by name or description..."
                className="w-full pl-9 pr-3 py-2.5 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 dark:text-white placeholder-gray-400 dark:placeholder-gray-600"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Filter
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>
      </Card>

      {/* Categories Table */}
      <Card title="Category List">
        <div className="mb-4">
          <p className="text-sm text-muted-foreground">
            Total {filteredCategories.length} categories
          </p>
        </div>
        <SmartTable
          dataSource={filteredCategories}
          columns={categoryColumns}
          rowKey="id"
        />
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing 1 to {filteredCategories.length} of{' '}
          {filteredCategories.length} categories
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm">
            1
          </Button>
          <Button variant="outline" size="sm">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

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
