'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Tag as TagIcon,
  Plus,
  Search,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useToastStore } from '@/store/useToastStore';
import { Card } from '@/components/UIComponents';
import { blogApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { BlogTagModal } from '@/views/blog/BlogTagModal';
import { ModalManager } from '@repo/ui';
import { useTranslation } from '@/hooks/useTranslation';
import { renderLocalizedText } from '@/utils/localizedText';

export default function TagsPage() {
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<any>(null);
  const [tags, setTags] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { addToast } = useToastStore();
  const router = useRouter();
  const { t, lang } = useTranslation();

  const fetchTags = async () => {
    setIsLoading(true);
    try {
      const response = await blogApi.getTags({ search });
      setTags(response.list || []);
    } catch (error) {
      console.error('Failed to fetch tags:', error);
      addToast('error', t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTags();
    }, 500);

    return () => clearTimeout(timer);
  }, [search]);

  const filteredTags = tags;

  const handleEditTag = (tag: any) => {
    setEditingTag(tag);
    setIsModalOpen(true);
  };

  const handleModalSuccess = () => {
    fetchTags();
  };

  const handleDeleteTag = async (tagId: string) => {
    ModalManager.open({
      title: t('deleteTag'),
      content: t('actionCannotBeUndone'),
      confirmText: t('deleteConfirm'),
      onCancel: () => {},
      onConfirm: async () => {
        try {
          await blogApi.deleteTag(tagId);
          addToast('success', t('tagDeleted'));
          fetchTags(); // Refresh the list
        } catch (error) {
          console.error('Failed to delete tag:', error);
          addToast('error', t('deleteFailed'));
        }
      },
    });
  };

  if (isLoading && tags.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">{t('loadingTags')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        showBackButton={true}
        onBack={() => router.push('/blog')}
        breadcrumbs={['Blog', 'Tags']}
        buttonText={t('newTag')}
        buttonOnClick={() => {
          setEditingTag(null);
          setIsModalOpen(true);
        }}
        buttonPrefixIcon={<Plus size={18} />}
      />

      {/* Search and Stats */}
      <Card>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 dark:text-white placeholder-gray-400 dark:placeholder-gray-600"
              />
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{tags.length}</div>
              <div className="text-xs text-muted-foreground">{t('totalTags')}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">
                {tags.reduce((sum, tag) => sum + (tag.articleCount || 0), 0)}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('taggedArticles')}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Tags Grid */}
      <Card title={t('tagList')}>
        <div className="mb-4">
          <p className="text-sm text-muted-foreground">
            {t('totalTagsCount', { count: filteredTags.length })}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {filteredTags.map((tag) => (
            <div
              key={tag.id}
              className="rounded-lg border border-gray-100 dark:border-white/5 bg-card p-4 hover:shadow-md transition-shadow hover:border-gray-200 dark:hover:border-white/10"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center">
                  <div
                    className={`p-2 rounded-lg ${
                      tag.color === 'blue'
                        ? 'bg-blue-100 text-blue-800'
                        : tag.color === 'green'
                          ? 'bg-green-100 text-green-800'
                          : tag.color === 'purple'
                            ? 'bg-purple-100 text-purple-800'
                            : tag.color === 'red'
                              ? 'bg-red-100 text-red-800'
                              : tag.color === 'amber'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    <TagIcon className="h-4 w-4" />
                  </div>
                  <div className="ml-3">
                      <h3 className="font-semibold">
                        {renderLocalizedText(tag.name, lang, tag.id)}
                      </h3>
                    <code className="text-xs text-muted-foreground">
                      /{tag.slug}
                    </code>
                  </div>
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => handleEditTag(tag)}
                    className="p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteTag(tag.id)}
                    className="p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
                <p className="text-sm text-muted-foreground mb-4">
                {renderLocalizedText(tag.description, lang, t('noDescription'))}
               </p>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-3">
                  <span className="px-2 py-1 rounded-full bg-primary/10 text-primary">
                    {tag.articleCount || 0} {t('articles')}
                  </span>
                  <span className="px-2 py-1 rounded-full bg-secondary/10 text-secondary">
                    {tag.usageCount || 0} {t('uses')}
                  </span>
                </div>
                <div className="text-muted-foreground">{tag.createdAt}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {t('showingTags', { current: filteredTags.length, total: filteredTags.length })}
        </div>
        <div className="flex items-center space-x-2">
          <button
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors">
            1
          </button>
          <button className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors">
            2
          </button>
          <button className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Usage Tips */}
      <Card title={t('tagUsageTips')}>
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
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>{t('tip5')}</span>
          </li>
        </ul>
      </Card>

      <BlogTagModal
        isOpen={isModalOpen}
        onCloseAction={() => setIsModalOpen(false)}
        editingTag={editingTag}
        onSuccessAction={handleModalSuccess}
      />
    </div>
  );
}
