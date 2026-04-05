'use client';

import { useState, useEffect } from 'react';
import {
  FolderTree,
  Plus,
  Search,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useToastStore } from '@/store/useToastStore';
import { blogApi } from '@/api';

export default function CategoriesPage() {
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategorySlug, setNewCategorySlug] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [categories, setCategories] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { addToast } = useToastStore();

  const fetchCategories = async () => {
    setIsLoading(true);
    try {
      const response = await blogApi.getCategories();
      setCategories(response.list || []);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
      addToast('error', 'Failed to load categories');
      // Fallback to mock data
      setCategories(getMockCategories());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const getMockCategories = () => {
    return [
      {
        id: '1',
        name: 'Technology',
        slug: 'technology',
        description: 'Articles about technology and programming',
        articleCount: 12,
        createdAt: '2026-03-15',
      },
      {
        id: '2',
        name: 'Lifestyle',
        slug: 'lifestyle',
        description: 'Articles about daily life and personal development',
        articleCount: 8,
        createdAt: '2026-03-20',
      },
      {
        id: '3',
        name: 'Learning',

        slug: 'learning',
        description: 'Articles about learning techniques and education',
        articleCount: 5,
        createdAt: '2026-03-25',
      },
      {
        id: '4',
        name: 'Database',
        slug: 'database',
        description: 'Articles about database design and optimization',
        articleCount: 7,
        createdAt: '2026-03-28',
      },
      {
        id: '5',
        name: 'Architecture',
        slug: 'architecture',
        description: 'Articles about system architecture and design patterns',
        articleCount: 4,
        createdAt: '2026-04-01',
      },
    ];
  };

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
      fetchCategories(); // Refresh the list
    } catch (error) {
      console.error('Failed to create category:', error);
      addToast('error', 'Failed to create category');
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (
      !window.confirm(
        'Are you sure you want to delete this category? This action cannot be undone.',
      )
    ) {
      return;
    }

    try {
      await blogApi.deleteCategory(categoryId);
      addToast('success', 'Category deleted successfully');
      fetchCategories(); // Refresh the list
    } catch (error) {
      console.error('Failed to delete category:', error);
      addToast('error', 'Failed to delete category');
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Category Management
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage blog categories for organizing articles
          </p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Category
        </button>
      </div>

      {/* Create Category Form */}
      {isCreating && (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">Create New Category</h2>
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
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <div className="flex items-center justify-end space-x-4 pt-4 border-t">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-4 py-2 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newCategoryName || !newCategorySlug}
                className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Category
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search categories by name or description..."
                className="w-full pl-9 pr-3 py-2 border border-input rounded-md bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Categories Table */}
      <div className="rounded-lg border bg-card">
        <div className="p-6 border-b">
          <h2 className="text-lg font-semibold">Category List</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Total {filteredCategories.length} categories
          </p>
        </div>
        <div className="p-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 text-sm font-medium">
                    Name
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium">
                    Slug
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium">
                    Description
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium">
                    Articles
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium">
                    Created
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredCategories.map((category) => (
                  <tr key={category.id} className="border-b hover:bg-muted/50">
                    <td className="py-3 px-4">
                      <div className="flex items-center">
                        <FolderTree className="mr-2 h-4 w-4 text-muted-foreground" />
                        <div className="font-medium">{category.name}</div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <code className="text-sm bg-muted px-2 py-1 rounded">
                        /{category.slug}
                      </code>
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-sm text-muted-foreground">
                        {category.description}
                      </p>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 text-xs rounded-full bg-primary/10 text-primary">
                        {category.articleCount || 0} articles
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-sm text-muted-foreground">
                        {category.createdAt}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button className="inline-flex items-center px-3 py-1.5 text-sm rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground">
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(category.id)}
                          className="inline-flex items-center px-3 py-1.5 text-sm rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing 1 to {filteredCategories.length} of{' '}
          {filteredCategories.length} categories
        </div>
        <div className="flex items-center space-x-2">
          <button
            className="px-3 py-1.5 text-sm rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            disabled
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="px-3 py-1.5 text-sm rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground">
            1
          </button>
          <button className="px-3 py-1.5 text-sm rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Usage Tips */}
      <div className="rounded-lg border bg-card p-6">
        <h3 className="text-sm font-medium mb-3">Category Usage Tips</h3>
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
      </div>
    </div>
  );
}
