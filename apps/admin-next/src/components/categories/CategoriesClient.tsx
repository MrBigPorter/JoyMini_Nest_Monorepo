'use client';

import React, { useState } from 'react';
import { Edit2, Plus, Trash2 } from 'lucide-react';
import { Button, Card } from '@/components/UIComponents';
import { useRequest } from 'ahooks';
import { categoryApi } from '@/api';
import { BlogCategoryModal } from '@/views/blog/BlogCategoryModal';
import { ModalManager } from '@repo/ui';
import { useTranslation } from '@/hooks/useTranslation';

interface BlogCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  articleCount?: number;
}

export const CategoryManagement: React.FC = () => {
  const { t } = useTranslation();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<{
    id: string;
    name: string;
    slug: string;
    description?: string;
  } | null>(null);

  const categories = useRequest(categoryApi.getCategories);

  const handleOpenModal = (category?: any) => {
    if (category) {
      setEditingItem({
        id: String(category.id),
        name: category.name,
        slug: category.slug || '',
        description: category.description,
      });
      setIsEditModalOpen(true);
    } else {
      setEditingItem(null);
      setIsCreateModalOpen(true);
    }
  };

  const { run: deleteCategory, loading: isDeleting } = useRequest(
    categoryApi.deleteCategory,
    {
      manual: true,
      onSuccess: () => {
        categories.refresh();
      },
    },
  );
  const remove = (id: string) => {
    ModalManager.open({
      title: t('categories_deleteTitle'),
      content: t('categories_deleteContent'),
      confirmText: t('categories_confirm'),
      cancelText: t('categories_cancel'),
      onConfirm: () => {
        if (isDeleting) return;
        deleteCategory(id);
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('categories_pageTitle')}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            {t('categories_pageDescription')}
          </p>
        </div>
        <Button onClick={() => handleOpenModal()} variant="outline">
          <Plus size={18} /> {t('categories_addCategory')}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {categories.data &&
          categories.data.map((cat) => (
            <Card
              key={cat.id}
              className="hover:border-primary-500/50 hover:shadow-lg hover:shadow-primary-500/5 cursor-pointer group relative"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-400 flex items-center justify-center">
                  <span className="text-lg font-bold">
                    {cat.name.charAt(0)}
                  </span>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenModal(cat);
                    }}
                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/10 rounded text-gray-400 hover:text-primary-500"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(cat.id.toString());
                    }}
                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/10 rounded text-gray-400 hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                {cat.name}
              </h3>
              <p className="text-sm text-gray-500">
                {t('categories_productsLinked', { count: cat.productCount })}
              </p>
            </Card>
          ))}
        <button
          onClick={() => handleOpenModal()}
          className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-200 dark:border-white/10 rounded-xl text-gray-400 hover:border-primary-500 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/5 transition-all cursor-pointer h-full min-h-[140px]"
        >
          <Plus size={24} className="mb-2" />
          <span className="font-medium">{t('categories_createNew')}</span>
        </button>
      </div>

      <BlogCategoryModal
        isOpen={isCreateModalOpen}
        onCloseAction={() => setIsCreateModalOpen(false)}
        onSuccessAction={categories.refresh}
      />

      <BlogCategoryModal
        isOpen={isEditModalOpen}
        onCloseAction={() => setIsEditModalOpen(false)}
        onSuccessAction={categories.refresh}
        editingCategory={editingItem}
      />
    </div>
  );
};
