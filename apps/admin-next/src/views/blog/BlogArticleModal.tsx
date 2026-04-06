'use client';

import React, { useEffect, useState } from 'react';
import { Modal, Button } from '@/components/UIComponents';
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
          categoryId: '',
          tagIds: [],
          status: 'DRAFT',
          featuredImage: '',
        },
      );
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
          <FormTextField
            name="title"
            label="Title"
            placeholder="Enter article title"
            required
          />
          <div>
            <label className="block text-sm font-medium mb-2">Content</label>
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
            label="Excerpt"
            placeholder="Brief summary of the article"
          />
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
