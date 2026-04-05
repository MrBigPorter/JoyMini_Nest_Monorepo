'use client';

import React, { useEffect, useState } from 'react';
import { Modal, Button } from '@/components/UIComponents';
import {
  Form,
  FormTextField,
  FormTextareaField,
  FormSelectField,
} from '@repo/ui/form';
import { useBlogForm } from '@/hooks/useBlogForm';
import { articleSchema, type ArticleFormInputs } from '@/schema/blog';
import { blogApi } from '@/api';
import { useRequest } from 'ahooks';
import { RichTextEditor } from '@/components/blog/RichTextEditor';
import { useToastStore } from '@/store/useToastStore';

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

  const form = useBlogForm({
    schema: articleSchema,
    defaultValues: editingArticle || {
      title: '',
      content: '',
      excerpt: '',
      categoryId: '',
      tagIds: [],
      status: 'draft',
      featuredImage: '',
    },
    onSubmit: async (data) => {
      if (isEditing && editingArticle) {
        await updateArticle(editingArticle.id, data);
      } else {
        await createArticle(data);
      }
    },
  });
  const { submitHandler, isLoading, errors, reset, watch, setValue } = form;

  useEffect(() => {
    if (isOpen) {
      reset(
        editingArticle || {
          title: '',
          content: '',
          excerpt: '',
          categoryId: '',
          tagIds: [],
          status: 'draft',
          featuredImage: '',
        },
      );
    }
  }, [isOpen, editingArticle, reset]);

  const loading = isCreating || isUpdating || isLoading || isLoadingData;

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
              onUpload={async (file) => {
                // Simulate upload, should be replaced with actual API
                return URL.createObjectURL(file);
              }}
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
          <div>
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
              { label: 'Draft', value: 'draft' },
              { label: 'Published', value: 'published' },
              { label: 'Scheduled', value: 'scheduled' },
            ]}
          />
          <FormTextField
            name="featuredImage"
            label="Featured Image URL"
            placeholder="https://example.com/image.jpg"
          />
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
