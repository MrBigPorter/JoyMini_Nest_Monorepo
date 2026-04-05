'use client';

import { useState, useEffect } from 'react';
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
import { blogApi } from '@/api';

export default function TagsPage() {
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagSlug, setNewTagSlug] = useState('');
  const [newTagDescription, setNewTagDescription] = useState('');
  const [tags, setTags] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { addToast } = useToastStore();

  const fetchTags = async () => {
    setIsLoading(true);
    try {
      const response = await blogApi.getTags();
      setTags(response.list || []);
    } catch (error) {
      console.error('Failed to fetch tags:', error);
      addToast('error', 'Failed to load tags');
      // Fallback to mock data
      setTags(getMockTags());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTags();
  }, []);

  const getMockTags = () => {
    return [
      {
        id: '1',
        name: 'Next.js',
        slug: 'nextjs',
        description: 'Articles about Next.js framework',
        articleCount: 8,
        usageCount: 42,
        createdAt: '2026-03-15',
        color: 'bg-blue-100 text-blue-800',
      },
      {
        id: '2',
        name: 'TypeScript',
        slug: 'typescript',
        description: 'Articles about TypeScript programming',
        articleCount: 12,
        usageCount: 65,
        createdAt: '2026-03-18',
        color: 'bg-indigo-100 text-indigo-800',
      },
      {
        id: '3',
        name: 'React',
        slug: 'react',
        description: 'Articles about React library',
        articleCount: 15,
        usageCount: 78,
        createdAt: '2026-03-20',
        color: 'bg-cyan-100 text-cyan-800',
      },
      {
        id: '4',
        name: 'Tailwind CSS',
        slug: 'tailwind-css',
        description: 'Articles about Tailwind CSS framework',
        articleCount: 6,
        usageCount: 32,
        createdAt: '2026-03-22',
        color: 'bg-teal-100 text-teal-800',
      },
      {
        id: '5',
        name: 'Database',
        slug: 'database',
        description: 'Articles about database technologies',
        articleCount: 9,
        usageCount: 45,
        createdAt: '2026-03-25',
        color: 'bg-emerald-100 text-emerald-800',
      },
      {
        id: '6',
        name: 'Performance',
        slug: 'performance',
        description: 'Articles about web performance optimization',
        articleCount: 7,
        usageCount: 38,
        createdAt: '2026-03-28',
        color: 'bg-amber-100 text-amber-800',
      },
      {
        id: '7',
        name: 'Security',
        slug: 'security',
        description: 'Articles about web security practices',
        articleCount: 5,
        usageCount: 28,
        createdAt: '2026-03-30',
        color: 'bg-red-100 text-red-800',
      },
      {
        id: '8',
        name: 'Architecture',
        slug: 'architecture',
        description: 'Articles about software architecture',
        articleCount: 4,
        usageCount: 22,
        createdAt: '2026-04-01',
        color: 'bg-purple-100 text-purple-800',
      },
    ];
  };

  const filteredTags = tags.filter((tag) => {
    return !(
      search &&
      !tag.name.toLowerCase().includes(search.toLowerCase()) &&
      !tag.description.toLowerCase().includes(search.toLowerCase())
    );
  });

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await blogApi.createTag({
        name: newTagName,
        slug: newTagSlug,
        description: newTagDescription,
      });
      addToast('success', 'Tag created successfully');
      setNewTagName('');
      setNewTagSlug('');
      setNewTagDescription('');
      setIsCreating(false);
      fetchTags(); // Refresh the list
    } catch (error) {
      console.error('Failed to create tag:', error);
      addToast('error', 'Failed to create tag');
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    if (
      !window.confirm(
        'Are you sure you want to delete this tag? This action cannot be undone.',
      )
    ) {
      return;
    }

    try {
      await blogApi.deleteTag(tagId);
      addToast('success', 'Tag deleted successfully');
      fetchTags(); // Refresh the list
    } catch (error) {
      console.error('Failed to delete tag:', error);
      addToast('error', 'Failed to delete tag');
    }
  };

  if (isLoading && tags.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Loading tags...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tag Management</h1>
          <p className="text-muted-foreground mt-2">
            Manage blog tags for categorizing and organizing articles
          </p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Tag
        </button>
      </div>

      {/* Create Tag Form */}
      {isCreating && (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">Create New Tag</h2>
          <form onSubmit={handleCreateTag} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">
                  Tag Name *
                </label>
                <input
                  id="name"
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="Enter tag name"
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
                  value={newTagSlug}
                  onChange={(e) => setNewTagSlug(e.target.value)}
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
                value={newTagDescription}
                onChange={(e) => setNewTagDescription(e.target.value)}
                placeholder="Enter tag description (optional)"
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
                disabled={!newTagName || !newTagSlug}
                className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Tag
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search and Stats */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tags by name or description..."
                className="w-full pl-9 pr-3 py-2 border border-input rounded-md bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{tags.length}</div>
              <div className="text-xs text-muted-foreground">Total Tags</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">
                {tags.reduce((sum, tag) => sum + (tag.articleCount || 0), 0)}
              </div>
              <div className="text-xs text-muted-foreground">
                Tagged Articles
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tags Grid */}
      <div className="rounded-lg border bg-card">
        <div className="p-6 border-b">
          <h2 className="text-lg font-semibold">Tag List</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Total {filteredTags.length} tags
          </p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {filteredTags.map((tag) => (
              <div
                key={tag.id}
                className="rounded-lg border bg-card p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center">
                    <div
                      className={`p-2 rounded-lg ${tag.color || 'bg-gray-100 text-gray-800'}`}
                    >
                      <TagIcon className="h-4 w-4" />
                    </div>
                    <div className="ml-3">
                      <h3 className="font-semibold">{tag.name}</h3>
                      <code className="text-xs text-muted-foreground">
                        /{tag.slug}
                      </code>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button className="p-1 text-muted-foreground hover:text-foreground">
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
                  {tag.description}
                </p>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-3">
                    <span className="px-2 py-1 rounded-full bg-primary/10 text-primary">
                      {tag.articleCount || 0} articles
                    </span>
                    <span className="px-2 py-1 rounded-full bg-secondary/10 text-secondary">
                      {tag.usageCount || 0} uses
                    </span>
                  </div>
                  <div className="text-muted-foreground">{tag.createdAt}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing 1 to {filteredTags.length} of {filteredTags.length} tags
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
            2
          </button>
          <button className="px-3 py-1.5 text-sm rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Usage Tips */}
      <div className="rounded-lg border bg-card p-6">
        <h3 className="text-sm font-medium mb-3">Tag Usage Tips</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>Tags help categorize articles with multiple topics</span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>Each article can have multiple tags (unlike categories)</span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>Use specific, descriptive tags rather than generic ones</span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>Popular tags are automatically highlighted in the blog</span>
          </li>
          <li className="flex items-start">
            <div className="mr-2 mt-0.5">•</div>
            <span>Tags can be merged if you have similar ones</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
