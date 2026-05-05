/**
 * API 接口定义 - Blog only
 */

import http from './http';
import type { LoginResponse, AdminUser } from '@/type/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 认证 API
 */
export const authApi = {
  // 登录
  login: (data: { username: string; password: string }) =>
    http.post<LoginResponse>('/v1/auth/admin/login', data, {
      headers: { 'x-skip-auth-refresh': '1' },
    }),

  // 登出
  logout: () => http.post('/v1/auth/admin/logout'),

  // 设置 HTTP-only Cookie
  setCookie: (token: string) =>
    http.post<{ ok: boolean }>(
      '/v1/auth/admin/set-cookie',
      { token },
      { withCredentials: true, headers: { 'x-skip-auth-refresh': '1' } },
    ),

  // 清除 HTTP-only Cookie
  clearCookie: () =>
    http.post<{ ok: boolean }>(
      '/v1/auth/admin/clear-cookie',
      {},
      { withCredentials: true, headers: { 'x-skip-auth-refresh': '1' } },
    ),

  // 刷新 token
  refreshToken: (refreshToken: string) =>
    http.post<{ tokens: { accessToken: string; refreshToken: string } }>(
      '/v1/auth/admin/refresh',
      { refreshToken },
    ),

  // 获取当前登录管理员信息
  getMe: () => http.get<AdminUser>('/v1/auth/admin/me'),
};

export const blogApi = {
  // Articles
  getArticles: async (params?: {
    page?: number;
    pageSize?: number;
    status?: string;
    categoryId?: string;
    tagId?: string;
    search?: string;
  }) => {
    const response = await http.get<{
      items: any[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>('/v1/admin/blog/articles', params);
    return {
      list: response.items,
      total: response.total,
      page: response.page,
      pageSize: response.pageSize,
      totalPages: response.totalPages,
    };
  },

  getArticle: async (id: string) => {
    return await http.get<any>(`/v1/admin/blog/articles/${id}`);
  },

  getArticleBySlug: async (slug: string, ssrToken?: string) => {
    const config = ssrToken
      ? { headers: { Authorization: `Bearer ${ssrToken}` } }
      : undefined;
    return await http.get<any>(
      `/v1/admin/blog/articles/slug/${slug}`,
      undefined,
      config,
    );
  },

  createArticle: async (payload: {
    title: Record<string, string | undefined>;
    content: Record<string, string | undefined>;
    excerpt?: Record<string, string | undefined>;
    categoryId?: string;
    tagIds?: string[];
    status?: string;
    featuredImage?: string | File;
  }) => {
    return await http.post<any>('/v1/admin/blog/articles', payload);
  },

  updateArticle: async (
    id: string,
    payload: {
      title?: Record<string, string | undefined>;
      content?: Record<string, string | undefined>;
      excerpt?: Record<string, string | undefined>;
      categoryId?: string;
      tagIds?: string[];
      status?: string;
      featuredImage?: string | File;
    },
  ) => {
    return await http.patch<any>(`/v1/admin/blog/articles/${id}`, payload);
  },

  // 扫描本地 Markdown 文件
  scanLocalArticles: async () => {
    return await http.get<any[]>('/v1/admin/blog/articles/scan-local');
  },

  // 批量导入文章
  batchImportArticles: async (payload: {
    articles: Array<{
      filename: string;
      slug: string;
      title: string;
      excerpt?: string;
      content: string;
      tags?: string[];
      subdir?: string | null;
      status?: string;
      categoryId?: string;
    }>;
    defaultStatus?: string;
    overwrite?: boolean;
  }) => {
    return await http.post<any>(
      '/v1/admin/blog/articles/batch-import',
      payload,
    );
  },

  deleteArticle: async (id: string) => {
    return await http.delete<any>(`/v1/admin/blog/articles/${id}`);
  },

  // Translation
  translateArticle: async (id: string) => {
    return await http.post<any>(`/v1/admin/blog/articles/${id}/translate`);
  },

  publishArticle: async (id: string) => {
    return await http.post<any>(`/v1/admin/blog/articles/${id}/publish`);
  },

  unpublishArticle: async (id: string) => {
    return await http.post<any>(`/v1/admin/blog/articles/${id}/unpublish`);
  },

  triggerVideoTranscode: async (articleId: string, videoKey: string) => {
    return await http.post(
      `/v1/admin/blog/articles/${articleId}/transcode-video`,
      { videoKey },
    );
  },

  // Categories
  getCategories: async (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
  }) => {
    const response = await http.get<any>('/v1/admin/blog/categories', params);
    const isArray = Array.isArray(response);
    const list = isArray ? response : response.list || [];
    const total = isArray ? response.length : response.total || list.length;
    const page = isArray ? 1 : response.page || 1;
    const pageSize = isArray ? total : response.pageSize || total;
    const mappedList = list.map((category: any) => ({
      ...category,
      articleCount: category._count?.articles || 0,
    }));
    return {
      list: mappedList,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / Math.max(pageSize, 1))),
    };
  },

  getCategory: async (id: string) => {
    return await http.get<any>(`/v1/admin/blog/categories/${id}`);
  },

  createCategory: async (payload: {
    name: Record<string, string | undefined>;
    slug?: string;
    description?: Record<string, string | undefined>;
    parentId?: string;
  }) => {
    return await http.post<any>('/v1/admin/blog/categories', payload);
  },

  updateCategory: async (
    id: string,
    payload: {
      name?: Record<string, string | undefined>;
      slug?: string;
      description?: Record<string, string | undefined>;
      parentId?: string;
    },
  ) => {
    return await http.patch<any>(`/v1/admin/blog/categories/${id}`, payload);
  },

  deleteCategory: async (id: string) => {
    return await http.delete<any>(`/v1/admin/blog/categories/${id}`);
  },

  // Tags
  getTags: async (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
  }) => {
    const response = await http.get<any>('/v1/admin/blog/tags', params);
    const isArray = Array.isArray(response);
    const list = isArray ? response : response.list || [];
    const total = isArray ? response.length : response.total || list.length;
    const page = isArray ? 1 : response.page || 1;
    const pageSize = isArray ? total : response.pageSize || total;
    const mappedList = list.map((tag: any) => ({
      ...tag,
      articleCount: tag._count?.articles || 0,
    }));
    return {
      list: mappedList,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / Math.max(pageSize, 1))),
    };
  },

  getTag: async (id: string) => {
    return await http.get<any>(`/v1/admin/blog/tags/${id}`);
  },

  createTag: async (payload: {
    name: Record<string, string | undefined>;
    slug?: string;
    color?: string;
    description?: Record<string, string | undefined>;
  }) => {
    return await http.post<any>('/v1/admin/blog/tags', payload);
  },

  updateTag: async (
    id: string,
    payload: {
      name?: Record<string, string | undefined>;
      slug?: string;
      description?: Record<string, string | undefined>;
    },
  ) => {
    return await http.patch<any>(`/v1/admin/blog/tags/${id}`, payload);
  },

  deleteTag: async (id: string) => {
    return await http.delete<any>(`/v1/admin/blog/tags/${id}`);
  },

  // Comments
  getComments: async (params?: {
    page?: number;
    pageSize?: number;
    status?: string;
    articleId?: string;
    search?: string;
  }) => {
    const data = await http.get<{
      items: any[];
      total: number;
      page: number;
      pageSize: number;
    }>('/v1/admin/blog/comments', params);
    return {
      list: data.items,
      total: data.total,
      page: data.page,
      pageSize: data.pageSize,
      totalPages: Math.max(
        1,
        Math.ceil(data.total / Math.max(data.pageSize, 1)),
      ),
    };
  },

  getComment: async (id: string) => {
    return await http.get<any>(`/v1/admin/blog/comments/${id}`);
  },

  updateComment: async (
    id: string,
    payload: {
      status?: string;
      reply?: Record<string, string>;
    },
  ) => {
    return await http.put<any>(`/v1/admin/blog/comments/${id}`, payload);
  },

  deleteComment: async (id: string) => {
    return await http.delete<any>(`/v1/admin/blog/comments/${id}`);
  },

  approveComment: async (id: string) => {
    return await http.post<any>(`/v1/admin/blog/comments/${id}/approve`);
  },

  rejectComment: async (id: string) => {
    return await http.post<any>(`/v1/admin/blog/comments/${id}/reject`);
  },

  // Statistics
  getBlogStatistics: async () => {
    return await http.get<any>('/v1/admin/blog/statistics');
  },

  // Translation related APIs
  translation: {
    getDefaultSourceLang: async () => {
      return await http.get<{ code: string; name: string; nativeName: string }>(
        '/v1/admin/system-config/translation/default-source-lang',
      );
    },

    updateDefaultSourceLang: async (code: string) => {
      return await http.patch(
        '/v1/admin/system-config/translation/default-source-lang',
        { code },
      );
    },

    getTranslationStats: async () => {
      return await http.get('/v1/admin/blog/translation/stats');
    },

    getTranslationProgress: async (languageCode?: string) => {
      return await http.get('/v1/admin/blog/translation-progress', {
        languageCode,
      });
    },

    getTranslationJobs: async () => {
      return await http.get('/v1/admin/blog/translation-jobs');
    },

    getTranslationJobsDetail: async (
      targetLang?: string,
      status?: string,
      page?: number,
      pageSize?: number,
    ) => {
      return await http.get('/v1/admin/blog/translation-jobs-detail', {
        targetLang,
        status,
        page,
        pageSize,
      });
    },

    getTranslationLogs: async (params?: {
      page?: number;
      pageSize?: number;
    }) => {
      return await http.get('/v1/admin/blog/translation-logs', params);
    },

    getTranslationIssues: async (languageCode?: string) => {
      return await http.get('/v1/admin/blog/translation-issues', {
        languageCode,
      });
    },

    fixTranslationIssuesBatch: async (params: {
      articleIds?: string[];
      languageCode?: string;
      issueTypes?: string[];
    }) => {
      return await http.post('/v1/admin/blog/translation-fix-batch', params);
    },

    getEnabledLanguages: async () => {
      return await http.get('/v1/admin/blog/enabled-languages');
    },

    getUntranslatedArticles: async (languageCode: string) => {
      return await http.get('/v1/admin/blog/untranslated-articles', {
        languageCode,
      });
    },

    getUntranslatedCategories: async (languageCode: string) => {
      return await http.get('/v1/admin/blog/untranslated-categories', {
        languageCode,
      });
    },

    getUntranslatedTags: async (languageCode: string) => {
      return await http.get('/v1/admin/blog/untranslated-tags', {
        languageCode,
      });
    },

    translateArticle: async (articleId: string, targetLang?: string) => {
      return await http.post(`/v1/admin/blog/articles/${articleId}/translate`, {
        targetLang,
      });
    },

    translateCategory: async (categoryId: string, targetLang?: string) => {
      return await http.post(
        `/v1/admin/blog/categories/${categoryId}/translate`,
        {
          targetLang,
        },
      );
    },

    translateTag: async (tagId: string, targetLang?: string) => {
      return await http.post(`/v1/admin/blog/tags/${tagId}/translate`, {
        targetLang,
      });
    },

    batchTranslateTags: async (ids: string[], targetLang?: string) => {
      return await http.post('/v1/admin/blog/tags/batch-translate', {
        ids,
        targetLang,
      });
    },

    batchTranslateCategories: async (ids: string[], targetLang?: string) => {
      return await http.post('/v1/admin/blog/categories/batch-translate', {
        ids,
        targetLang,
      });
    },

    /** 批量修复未翻译的分类和标签（检测含中文的非 zh 字段并重新投递翻译） */
    repairUntranslatedCategoriesTags: async (languageCode?: string) => {
      return await http.post(
        '/v1/admin/blog/translation/repair-categories-tags',
        { languageCode },
      );
    },

    /** 检测翻译不完整的文章（新增）*/
    detectIncompleteTranslations: async (targetLang: string = 'en') => {
      return await http.get('/v1/admin/blog/translation/detect-incomplete', {
        lang: targetLang,
      });
    },

    /** 批量重新翻译不完整的文章（新增）*/
    retranslateIncompleteArticles: async (targetLang: string = 'en') => {
      return await http.post(
        '/v1/admin/blog/translation/retranslate-incomplete',
        {
          lang: targetLang,
        },
      );
    },

    triggerVideoTranscode: async (articleId: string, videoKey: string) => {
      return await http.post(
        `/v1/admin/blog/articles/${articleId}/trigger-video-transcode`,
        { videoKey },
      );
    },

    /** 获取AI服务状态（服务等级、API Key额度、健康状况） */
    getAiStatus: async () => {
      return await http.get('/v1/admin/blog/ai/status');
    },

    /** 获取可用的AI提供商列表及模型 */
    getAiProviders: async () => {
      return await http.get('/v1/admin/blog/ai/providers');
    },

    /** 获取当前AI提供商/模型配置 */
    getAiProviderConfig: async () => {
      return await http.get('/v1/admin/blog/ai/provider-config');
    },

    /** 更新AI提供商/模型配置 */
    updateAiProviderConfig: async (data: {
      provider: string;
      model: string;
    }) => {
      return await http.patch('/v1/admin/blog/ai/provider-config', data);
    },
  },
};

/**
 * 系统配置管理 API (blog-relevant subset)
 */
export const systemConfigApi = {
  getAll: () =>
    http.get<{ list: import('@/type/types').SystemConfigItem[] }>(
      '/v1/admin/system-config',
    ),
  create: (data: { key: string; value: string }) =>
    http.post<import('@/type/types').SystemConfigItem>(
      '/v1/admin/system-config',
      data,
    ),
  update: (key: string, value: string) =>
    http.patch<import('@/type/types').SystemConfigItem>(
      `/v1/admin/system-config/${key}`,
      { value },
    ),
  delete: (key: string) =>
    http.delete<{ success: boolean }>(`/v1/admin/system-config/${key}`),

  // 语言管理专用 API（blog 独立，读写 blog.enabled_locales）
  getBlogLocales: () =>
    http.get<{
      list: Array<{
        code: string;
        name: string;
        nativeName: string;
        enabled: boolean;
        isDefault: boolean;
      }>;
    }>('/v1/admin/system-config/blog/locales'),

  toggleBlogLocale: (code: string, enabled: boolean) =>
    http.patch(`/v1/admin/system-config/blog/locales/${code}`, { enabled }),

  // 翻译管理专用 API
  getDefaultSourceLang: () =>
    http.get<{
      code: string;
      name: string;
      nativeName: string;
    }>('/v1/admin/system-config/translation/default-source-lang'),

  updateDefaultSourceLang: (code: string) =>
    http.patch<{ success: boolean }>(
      '/v1/admin/system-config/translation/default-source-lang',
      { code },
    ),
};

/**
 * 文件上传 API
 */
export const uploadApi = {
  // 上传文件
  uploadMedia: (
    file: File,
    onProgress?: (percent: number) => void,
    extraFields?: Record<string, string>,
  ) =>
    http.upload<{ url: string; key: string }>(
      '/v1/admin/upload/image',
      file,
      onProgress,
      {
        extraFields,
      },
    ),

  // 批量上传
  uploadMultiple: (files: File[]) => {
    const formData = new FormData();
    files.forEach((file, index) => {
      formData.append(`files[${index}]`, file);
    });
    return http.upload<{ urls: string[] }>('/upload/multiple', formData);
  },
};
