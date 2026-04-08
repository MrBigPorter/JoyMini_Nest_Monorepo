'use client';

import React, { useEffect, useState } from 'react';
import { Modal, Button } from '@/components/UIComponents';
import { Globe } from 'lucide-react';
import {
  Form,
  FormTextField,
  FormTextareaField,
  FormSelectField,
  FormMediaUploaderField,
} from '@repo/ui/form';
import { useBlogForm } from '@/hooks/useBlogForm';
import { articleSchema, type ArticleFormInputs } from '@/schema/blog';
import { blogApi, uploadApi } from '@/api';
import { useRequest } from 'ahooks';
import { RichTextEditor } from '@/components/blog/RichTextEditor';
import { useToastStore } from '@/store/useToastStore';
import { SmartImage } from '@/components/ui/SmartImage';
import { Info } from 'lucide-react';

interface BlogArticleModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  editingArticle?: (Partial<ArticleFormInputs> & { id: string }) | null;
  onSuccessAction: () => void;
}

export const BlogArticleModal: React.FC<BlogArticleModalProps> = ({
  isOpen,
  onCloseAction,
  editingArticle,
  onSuccessAction,
}) => {
  const isEditing = !!editingArticle;
  const addToast = useToastStore((state) => state.addToast);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [activeLanguageTab, setActiveLanguageTab] = useState<string>('zh');
  const [isTranslating, setIsTranslating] = useState(false);

  // Fetch categories and tags
  useEffect(() => {
    if (isOpen) {
      const fetchData = async () => {
        setIsLoadingData(true);
        try {
          const [categoriesRes, tagsRes] = await Promise.all([
            blogApi.getCategories(),
            blogApi.getTags(),
          ]);
          setCategories(categoriesRes.list || []);
          setTags(tagsRes.list || []);
        } catch (error) {
          console.error('Failed to fetch categories/tags:', error);
          addToast('error', 'Failed to load categories/tags');
        } finally {
          setIsLoadingData(false);
        }
      };
      fetchData();
    }
  }, [isOpen, addToast]);

  const { run: createArticle, loading: isCreating } = useRequest(
    blogApi.createArticle,
    {
      manual: true,
      onSuccess: () => {
        onSuccessAction();
        onCloseAction();
      },
    },
  );

  const { run: updateArticle, loading: isUpdating } = useRequest(
    blogApi.updateArticle,
    {
      manual: true,
      onSuccess: () => {
        onSuccessAction();
        onCloseAction();
      },
    },
  );

  const upload = useRequest(uploadApi.uploadMedia, {
    manual: true,
  });

  const form = useBlogForm({
    schema: articleSchema,
    defaultValues: editingArticle
      ? {
          ...editingArticle,
          featuredImage:
            (
              editingArticle as Partial<ArticleFormInputs> & {
                id: string;
                coverImage?: string;
              }
            )?.coverImage ||
            editingArticle.featuredImage ||
            '',
        }
      : {
          title: '',
          content: '',
          excerpt: '',
          categoryId: '',
          tagIds: [],
          status: 'DRAFT',
          featuredImage: '',
        },
    onSubmit: async (data) => {
      try {
        let featuredImageUrl = data.featuredImage;
        // 如果 featuredImage 是 File 对象，则上传
        if (featuredImageUrl instanceof File) {
          const res = await upload.runAsync(featuredImageUrl);
          featuredImageUrl = res.url;
        }
        const payload = { ...data, featuredImage: featuredImageUrl };
        if (isEditing && editingArticle) {
          await updateArticle(editingArticle.id, payload);
        } else {
          await createArticle(payload);
        }
      } catch (error) {
        // 上传失败或 API 调用失败，错误已由 HTTP 拦截器或 upload 处理
        console.error('Submit failed:', error);
      }
    },
  });
  const { submitHandler, isLoading, errors, reset, watch, setValue } = form;

  useEffect(() => {
    console.log('content', editingArticle);
    if (isOpen) {
      const mappedArticle = editingArticle
        ? {
            ...editingArticle,
            featuredImage:
              (
                editingArticle as Partial<ArticleFormInputs> & {
                  id: string;
                  coverImage?: string;
                }
              )?.coverImage ||
              editingArticle.featuredImage ||
              '',
          }
        : null;
      reset(
        mappedArticle || {
          title: '',
          content: '',
          excerpt: '',
          titleEn: '',
          contentEn: '',
          excerptEn: '',
          categoryId: '',
          tagIds: [],
          status: 'DRAFT',
          featuredImage: '',
        },
      );

      // 如果文章有英文内容，自动切换到英文标签页
      if (editingArticle?.titleEn || editingArticle?.contentEn) {
        setActiveLanguageTab('en');
      } else {
        setActiveLanguageTab('zh');
      }
    }
  }, [isOpen, editingArticle, reset]);

  const loading = isCreating || isUpdating || isLoading || isLoadingData;

  // Handle image upload for RichTextEditor
  const handleEditorUpload = async (file: File): Promise<string> => {
    try {
      const res = await upload.runAsync(file);
      return res.url;
    } catch (error) {
      addToast('error', 'Failed to upload image');
      throw error;
    }
  };

  // Handle RichTextEditor content change
  const handleContentChange = (content: string) => {
    setValue('content', content);
  };

  // Handle tag selection (multi-select)
  const handleTagToggle = (tagId: string) => {
    const currentTagIds = watch('tagIds') || [];
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter((id) => id !== tagId)
      : [...currentTagIds, tagId];
    setValue('tagIds', newTagIds);
  };

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={`${isEditing ? 'Edit' : 'Create'} Article`}
      size="lg"
    >
      <Form {...form}>
        <form onSubmit={submitHandler} className="space-y-6">
          {/* Language Switcher */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={activeLanguageTab === 'zh' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setActiveLanguageTab('zh')}
              >
                🇨🇳 中文
              </Button>
              <Button
                type="button"
                variant={activeLanguageTab === 'en' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setActiveLanguageTab('en')}
              >
                🇺🇸 English
              </Button>
            </div>

            {isEditing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
                isLoading={isTranslating}
                onClick={async () => {
                  if (!editingArticle?.id) return;
                  try {
                    setIsTranslating(true);
                    await blogApi.translateArticle(editingArticle.id);
                    addToast('success', '翻译请求已发送，稍后将自动刷新');
                    // 刷新文章数据
                    setTimeout(async () => {
                      const updatedArticle = await blogApi.getArticle(
                        editingArticle.id,
                      );
                      // 先切换Tab再更新数据，保证富文本编辑器正确渲染
                      setActiveLanguageTab('en');
                      // 小延迟保证DOM更新完成
                      setTimeout(() => {
                        console.log('✅ 翻译返回数据:', {
                          titleEn: updatedArticle.titleEn,
                          contentEn: updatedArticle.contentEn,
                          excerptEn: updatedArticle.excerptEn,
                        });

                        // ✅ 只更新三个英文字段，其他所有值完全不动
                        setValue('titleEn', updatedArticle.titleEn);
                        setValue('contentEn', updatedArticle.contentEn);
                        setValue('excerptEn', updatedArticle.excerptEn);
                      }, 100);
                    }, 1500);
                  } catch (error) {
                    console.error('Translation failed:', error);
                    addToast('error', '翻译失败，请稍后重试');
                  } finally {
                    setIsTranslating(false);
                  }
                }}
              >
                <Globe size={16} />
                重新翻译
              </Button>
            ) : (
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <Globe size={14} />
                保存后自动翻译英文版本
              </div>
            )}
          </div>

          {/* Language Specific Fields - 使用display隐藏而不是销毁组件 */}
          <div
            style={{ display: activeLanguageTab === 'zh' ? 'block' : 'none' }}
            className="space-y-6"
          >
            <FormTextField
              name="title"
              label="标题"
              placeholder="输入文章标题"
              required
            />
            <div>
              <label className="block text-sm font-medium mb-2">内容</label>
              <RichTextEditor
                value={watch('content')}
                onChange={handleContentChange}
                onUpload={handleEditorUpload}
              />
              {errors.content?.message && (
                <p className="text-red-500 text-sm mt-1">
                  {errors.content.message}
                </p>
              )}
            </div>
            <FormTextareaField
              name="excerpt"
              label="摘要"
              placeholder="文章简要概述"
            />
          </div>

          <div
            style={{ display: activeLanguageTab === 'en' ? 'block' : 'none' }}
            className="space-y-6"
          >
            <FormTextField
              name="titleEn"
              label="Title (English)"
              placeholder="Enter article title in English"
            />
            <div>
              <label className="block text-sm font-medium mb-2">
                Content (English)
              </label>
              <RichTextEditor
                value={watch('contentEn') || ''}
                onChange={(content) => setValue('contentEn', content)}
                onUpload={handleEditorUpload}
              />
              {errors.contentEn?.message && (
                <p className="text-red-500 text-sm mt-1">
                  {errors.contentEn.message}
                </p>
              )}
            </div>
            <FormTextareaField
              name="excerptEn"
              label="Excerpt (English)"
              placeholder="Brief summary in English"
            />
          </div>

          {/* Common Fields - Always Visible */}
          <FormSelectField
            name="categoryId"
            label="Category"
            placeholder="Select category"
            options={categories.map((c) => ({ label: c.name, value: c.id }))}
          />
          <div className="p-4 border rounded-lg shadow-sm">
            <label className="block text-sm font-medium mb-2">Tags</label>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const selected = (watch('tagIds') || []).includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={`px-3 py-1.5 rounded-full text-sm border ${
                      selected
                        ? 'bg-primary-500 text-white border-primary-500'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                    }`}
                    onClick={() => handleTagToggle(tag.id)}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
            {errors.tagIds?.message && (
              <p className="text-red-500 text-sm mt-1">
                {errors.tagIds.message}
              </p>
            )}
          </div>
          <FormSelectField
            name="status"
            label="Status"
            options={[
              { label: 'Draft', value: 'DRAFT' },
              { label: 'Published', value: 'PUBLISHED' },
              { label: 'Archived', value: 'ARCHIVED' },
            ]}
          />
          <div className="p-4  rounded-lg shadow-sm">
            <FormMediaUploaderField
              name="featuredImage"
              label="Featured Image"
              maxFileCount={1}
              renderImage={({ src, alt, className }) => (
                <SmartImage
                  src={src}
                  alt={alt}
                  width={400}
                  height={400}
                  className={className}
                  imgClassName="w-64 h-64 rounded-md object-cover"
                  layout="constrained"
                />
              )}
            />
            <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
              <Info size={12} /> Recommended 800x800px
            </p>
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onCloseAction}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={loading}>
              {isEditing ? 'Update' : 'Publish'}
            </Button>
          </div>
        </form>
      </Form>
    </Modal>
  );
};
