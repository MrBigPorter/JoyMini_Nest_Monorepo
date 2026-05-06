'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';
import { Card } from '@/components/UIComponents';
import { useRequest } from 'ahooks';
import { categoryApi } from '@/api';
import { ModalManager } from '@repo/ui';
import { useTranslation } from '@/hooks/useTranslation';

export const CategoryManagement: React.FC = () => {
  const { t } = useTranslation();

  const categories = useRequest(categoryApi.getCategories);

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
                    {Array.from(cat.name)[0]}
                  </span>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
      </div>
    </div>
  );
};
