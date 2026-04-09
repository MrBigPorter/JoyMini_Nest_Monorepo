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
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

interface BlogArticleModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  editingArticle?: (Partial<ArticleFormInputs> & { id: string }) | null;
  onSuccessAction: () => void;
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  silent: true, // 原样保留HTML标签，不做转码
});

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
    defaultValues: {
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
    onSubmit: async (data) => {
      try {
        let featuredImageUrl = data.featuredImage;
        // 如果 featuredImage 是 File 对象，则上传
        if (featuredImageUrl instanceof File) {
          const res = await upload.runAsync(featuredImageUrl);
          featuredImageUrl = res.url;
        }

        //  强制读取所有字段，不管是否在当前Tab
        const allData = {
          ...data,
          titleEn: form.getValues('titleEn'),
          contentEn: form.getValues('contentEn'),
          excerptEn: form.getValues('excerptEn'),
          featuredImage: featuredImageUrl,
        };

        if (isEditing && editingArticle) {
          await updateArticle(editingArticle.id, allData);
        } else {
          await createArticle(allData);
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
      const mappedArticle: any = editingArticle
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
            categoryId:
              (editingArticle as any).categoryId ||
              (editingArticle as any)?.category?.id ||
              '',
          }
        : null;

      //  关键修复：预处理内容，解决 MD 混用问题
      let initContent =
        (mappedArticle as any)?.contentMd || mappedArticle?.content || '';
      let initContentEn =
        (mappedArticle as any)?.contentMdEn || mappedArticle?.contentEn || '';

      // 判断逻辑：如果内容存在，且不包含 HTML 标签特征，说明大概率是纯 Markdown
      // 在将其放进 RichTextEditor 之前，强制转换为 HTML
      if (initContent && !/<[a-z][\s\S]*>/i.test(initContent)) {
        initContent = marked.parse(initContent) as string;
      }
      if (initContentEn && !/<[a-z][\s\S]*>/i.test(initContentEn)) {
        initContentEn = marked.parse(initContentEn) as string;
      }

      reset({
        title: mappedArticle?.title || '',
        content: initContent, // 使用预处理后的 HTML
        excerpt: mappedArticle?.excerpt || '',
        titleEn: mappedArticle?.titleEn || '',
        contentEn: initContentEn, // 使用预处理后的 HTML
        excerptEn: mappedArticle?.excerptEn || '',

        categoryId:
          (mappedArticle as any)?.categoryId ||
          (mappedArticle as any)?.category?.id ||
          '',
        tagIds:
          mappedArticle?.tagIds?.map((t: any) => t.id) ||
          mappedArticle?.tagIds ||
          [],
        status: mappedArticle?.status || 'DRAFT',
        featuredImage: mappedArticle?.featuredImage || '',
      });

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

  // 预览语言切换
  const [previewLanguage, setPreviewLanguage] = useState<'zh' | 'en'>('zh');
  const [showPreview, setShowPreview] = useState(false);

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={`${isEditing ? 'Edit' : 'Create'} Article`}
    >
      <Form {...form}>
        <form onSubmit={submitHandler} className="space-y-6">
          {/* 顶部操作栏 */}
          <div className="flex items-center justify-between mb-4">
            {/* Language Switcher */}
            <div className="flex items-center gap-2">
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
                          console.log(' 翻译返回数据:', {
                            titleEn: updatedArticle.titleEn,
                            contentEn: updatedArticle.contentEn,
                            excerptEn: updatedArticle.excerptEn,
                          });

                          //  只更新三个英文字段，其他所有值完全不动
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
          <div className="flex justify-between items-center pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? '关闭预览' : '预览文章'}
            </Button>

            <div className="flex gap-3">
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
          </div>

          {/* 预览区域 */}
          {showPreview && (
            <div className="mt-6 border rounded-lg p-6 bg-gray-50 dark:bg-gray-800">
              <div className="flex justify-end mb-4">
                <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700">
                  <button
                    type="button"
                    onClick={() => setPreviewLanguage('zh')}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      previewLanguage === 'zh'
                        ? 'bg-primary-500 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    🇨🇳 中文
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewLanguage('en')}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      previewLanguage === 'en'
                        ? 'bg-primary-500 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    🇺🇸 English
                  </button>
                </div>
              </div>

              <div className="max-w-[720px] mx-auto">
                <h1 className="text-3xl font-bold mb-6">
                  {previewLanguage === 'zh'
                    ? watch('title')
                    : watch('titleEn') || watch('title')}
                </h1>
                <p className="text-lg text-gray-500 mb-6">
                  {previewLanguage === 'zh'
                    ? watch('excerpt')
                    : watch('excerptEn') || watch('excerpt')}
                </p>
                <div
                  className="prose prose-slate dark:prose-invert prose-lg max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: (() => {
                      const rawContent =
                        previewLanguage === 'zh'
                          ? watch('content')
                          : watch('contentEn') || watch('content');

                      if (!rawContent) return '';

                      // marked 会自动同时处理 Markdown 和 HTML 混合内容
                      const htmlContent = marked.parse(rawContent) as string;

                      // 统一安全净化
                      return typeof window !== 'undefined'
                        ? DOMPurify.sanitize(htmlContent, {
                            USE_PROFILES: { html: true },
                            ADD_ATTR: ['target', 'rel'],
                            FORBID_TAGS: ['style', 'script'],
                          })
                        : '';
                    })(),
                  }}
                />
              </div>
            </div>
          )}
        </form>
      </Form>
    </Modal>
  );
};
