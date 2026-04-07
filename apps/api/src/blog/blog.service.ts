import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { ArticleStatus } from '@prisma/client';
import { CreateArticleDto, UpdateArticleDto } from './dto';

@Injectable()
export class BlogService {
  constructor(private prisma: PrismaService) {}
  /**
   * 生成唯一 Slug
   */
  async generateUniqueSlug(title: string, excludeId?: string): Promise<string> {
    const baseSlug = title
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 100);

    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.prisma.blogArticle.findFirst({
        where: {
          slug,
          id: excludeId ? { not: excludeId } : undefined,
        },
        select: { id: true },
      });

      if (!existing) {
        break;
      }

      slug = `${baseSlug}-${++counter}`;
    }

    return slug;
  }

  /**
   * 创建文章
   */
  async createArticle(authorId: string, dto: CreateArticleDto) {
    const slug = await this.generateUniqueSlug(dto.title);
    return this.prisma.blogArticle.create({
      data: {
        title: dto.title,
        slug,
        content: dto.content,
        excerpt: dto.excerpt,
        coverImage: dto.featuredImage,
        status: dto.status || ArticleStatus.DRAFT,
        authorId,
        categoryId: dto.categoryId,
        tags: dto.tagIds
          ? {
              connect: dto.tagIds.map((id) => ({ id })),
            }
          : undefined,
      },
      include: {
        category: true,
        tags: true,
      },
    });
  }

  /**
   * 更新文章
   */
  async updateArticle(
    articleId: string,
    authorId: string,
    dto: UpdateArticleDto,
  ) {
    const article = await this.checkArticleOwner(articleId, authorId);

    let slug = article.slug;
    if (dto.title && dto.title !== article.title) {
      slug = await this.generateUniqueSlug(dto.title, articleId);
    }

    return this.prisma.blogArticle.update({
      where: { id: articleId },
      data: {
        title: dto.title,
        slug,
        content: dto.content,
        excerpt: dto.excerpt,
        coverImage: dto.featuredImage,
        status: dto.status,
        categoryId: dto.categoryId,
        tags:
          dto.tagIds !== undefined
            ? {
                set: dto.tagIds.map((id) => ({ id })),
              }
            : undefined,
      },
      include: {
        category: true,
        tags: true,
      },
    });
  }

  /**
   * 检查文章作者权限
   */
  async checkArticleOwner(articleId: string, authorId: string) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { id: articleId },
      select: {
        id: true,
        authorId: true,
        status: true,
        slug: true,
        title: true,
      },
    });

    if (!article) {
      throw new NotFoundException('文章不存在');
    }

    if (article.authorId !== authorId) {
      throw new ForbiddenException('只能编辑自己的文章');
    }

    return article;
  }

  /**
   * 获取文章列表
   */
  async getArticles(params: {
    page?: number;
    pageSize?: number;
    status?: ArticleStatus;
    categoryId?: string;
    tagId?: string;
    authorId?: string;
    search?: string;
  }) {
    const {
      page = 1,
      pageSize = 20,
      status,
      categoryId,
      tagId,
      authorId,
      search,
    } = params;
    const skip = (page - 1) * pageSize;

    const where: any = {};

    if (search && search.trim()) {
      const searchTerm = search.trim();
      where.OR = [
        { title: { contains: searchTerm, mode: 'insensitive' } },
        { content: { contains: searchTerm, mode: 'insensitive' } },
        { excerpt: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (tagId) {
      where.tags = {
        some: { id: tagId },
      };
    }

    if (authorId) {
      where.authorId = authorId;
    }

    const [items, total] = await Promise.all([
      this.prisma.blogArticle.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          content: true,
          coverImage: true,
          status: true,
          viewCount: true,
          commentCount: true,
          createdAt: true,
          publishedAt: true,
          author: { select: { id: true, username: true, realName: true } },
          category: true,
          tags: true,
        },
      }),
      this.prisma.blogArticle.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取文章详情
   */
  async getArticle(id: string, incrementView = false) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, username: true, realName: true } },
        category: true,
        tags: true,
      },
    });

    if (!article) {
      throw new NotFoundException('文章不存在');
    }

    if (incrementView) {
      // 异步更新浏览次数，不阻塞请求
      this.prisma.blogArticle
        .update({
          where: { id },
          data: { viewCount: { increment: 1 } },
        })
        .catch(() => {
          // 静默失败
        });
    }

    return article;
  }

  /**
   * 通过 Slug 获取文章
   */
  async getArticleBySlug(slug: string, incrementView = false) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { slug },
      include: {
        author: { select: { id: true, username: true, realName: true } },
        category: true,
        tags: true,
      },
    });

    if (!article) {
      throw new NotFoundException('文章不存在');
    }

    if (incrementView) {
      this.prisma.blogArticle
        .update({
          where: { slug },
          data: { viewCount: { increment: 1 } },
        })
        .catch(() => {});
    }

    return article;
  }

  /**
   * 删除文章
   */
  async deleteArticle(articleId: string, authorId: string) {
    await this.checkArticleOwner(articleId, authorId);

    return this.prisma.blogArticle.delete({
      where: { id: articleId },
    });
  }

  /**
   * 发布文章
   */
  async publishArticle(articleId: string, authorId: string) {
    await this.checkArticleOwner(articleId, authorId);

    return this.prisma.blogArticle.update({
      where: { id: articleId },
      data: {
        status: ArticleStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });
  }

  /**
   * 取消发布文章（设为草稿）
   */
  async unpublishArticle(articleId: string, authorId: string) {
    await this.checkArticleOwner(articleId, authorId);

    return this.prisma.blogArticle.update({
      where: { id: articleId },
      data: {
        status: ArticleStatus.DRAFT,
        publishedAt: null,
      },
    });
  }

  /**
   * 获取博客统计数据
   */
  async getBlogStats() {
    const [
      totalArticles,
      totalCategories,
      totalTags,
      totalViews,
      totalComments,
    ] = await Promise.all([
      this.prisma.blogArticle.count({
        where: { status: ArticleStatus.PUBLISHED },
      }),
      this.prisma.blogCategory.count(),
      this.prisma.blogTag.count(),
      this.prisma.blogArticle.aggregate({ _sum: { viewCount: true } }),
      this.prisma.blogComment.count(),
    ]);

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const weeklyPublishes = await this.prisma.blogArticle.count({
      where: {
        status: ArticleStatus.PUBLISHED,
        publishedAt: { gte: oneWeekAgo },
      },
    });

    return {
      totalArticles,
      totalCategories,
      totalTags,
      totalViews: totalViews._sum.viewCount || 0,
      totalComments,
      weeklyPublishes,
    };
  }

  /**
   * 获取热门标签
   */
  async getPopularTags(limit: number) {
    return this.prisma.blogTag.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * 获取文章归档
   */
  async getArticleArchive() {
    const articles = await this.prisma.blogArticle.findMany({
      where: { status: ArticleStatus.PUBLISHED },
      select: {
        id: true,
        title: true,
        slug: true,
        publishedAt: true,
        createdAt: true,
      },
      orderBy: { publishedAt: 'desc' },
    });

    const archive: Record<string, any> = {};

    articles.forEach((article) => {
      const date = article.publishedAt || article.createdAt;
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const key = `${year}-${month}`;

      if (!archive[key]) {
        archive[key] = {
          year,
          month,
          count: 0,
          articles: [],
        };
      }

      archive[key].count++;
      archive[key].articles.push(article);
    });

    return Object.values(archive);
  }

  /**
   * 文章点赞
   */
  async likeArticle(slug: string, fingerprint: string) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { slug },
    });
    if (!article) throw new NotFoundException('文章不存在');

    // 这里后续可以添加指纹去重逻辑
    return this.prisma.blogArticle.update({
      where: { slug },
      data: { likeCount: { increment: 1 } },
      select: { likeCount: true },
    });
  }

  /**
   * 取消文章点赞
   */
  async unlikeArticle(slug: string, fingerprint: string) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { slug },
    });
    if (!article) throw new NotFoundException('文章不存在');

    return this.prisma.blogArticle.update({
      where: { slug },
      data: { likeCount: { decrement: 1 } },
      select: { likeCount: true },
    });
  }

  /**
   * 检查点赞状态
   */
  async checkLikeStatus(slug: string, fingerprint: string) {
    // 后续实现指纹检查逻辑
    return { liked: false };
  }

  /**
   * 创建评论
   */
  async createComment(slug: string, dto: any, userId?: string | null) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { slug },
    });
    if (!article) throw new NotFoundException('文章不存在');

    const commentData: any = {
      articleId: article.id,
      content: dto.content,
      parentId: dto.parentId,
    };

    if (userId) {
      commentData.userId = userId;
    } else {
      commentData.author = dto.author;
      commentData.email = dto.email;
      commentData.website = dto.website;
    }

    const comment = await this.prisma.blogComment.create({
      data: commentData,
    });

    // 更新文章评论计数
    await this.prisma.blogArticle.update({
      where: { id: article.id },
      data: { commentCount: { increment: 1 } },
    });

    return comment;
  }

  /**
   * 获取热门文章
   */
  async getPopularArticles(limit = 10) {
    return this.prisma.blogArticle.findMany({
      where: { status: ArticleStatus.PUBLISHED },
      orderBy: { viewCount: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        slug: true,
        coverImage: true,
        viewCount: true,
        publishedAt: true,
      },
    });
  }

  /**
   * 获取相关文章
   */
  async getRelatedArticles(articleId: string, limit = 5) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { id: articleId },
      include: { tags: true },
    });

    if (!article) throw new NotFoundException('文章不存在');

    const tagIds = article.tags.map((t) => t.id);

    return this.prisma.blogArticle.findMany({
      where: {
        id: { not: articleId },
        status: ArticleStatus.PUBLISHED,
        tags: { some: { id: { in: tagIds } } },
      },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        slug: true,
        coverImage: true,
        publishedAt: true,
      },
    });
  }

  /**
   * 获取分类列表
   */
  async getCategories() {
    return this.prisma.blogCategory.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 按Slug获取分类及文章
   */
  async getCategoryBySlugWithArticles(slug: string, params: any) {
    const category = await this.prisma.blogCategory.findUnique({
      where: { slug },
    });
    if (!category) throw new NotFoundException('分类不存在');

    const articles = await this.getArticles({
      ...params,
      categoryId: category.id,
    });

    return { category, ...articles };
  }

  /**
   * 获取标签列表
   */
  async getTags() {
    return this.prisma.blogTag.findMany({
      orderBy: { name: 'asc' },
    });
  }

  /**
   * 按Slug获取标签及文章
   */
  async getTagBySlugWithArticles(slug: string, params: any) {
    const tag = await this.prisma.blogTag.findUnique({ where: { slug } });
    if (!tag) throw new NotFoundException('标签不存在');

    const articles = await this.getArticles({
      ...params,
      tagId: tag.id,
    });

    return { tag, ...articles };
  }

  /**
   * 获取文章评论
   */
  async getArticleComments(slug: string, params: any) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { slug },
    });
    if (!article) throw new NotFoundException('文章不存在');

    const { page = 1, pageSize = 20 } = params;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.blogComment.findMany({
        where: { articleId: article.id },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.blogComment.count({
        where: { articleId: article.id },
      }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 搜索文章
   */
  async searchArticles(query: string, params: any) {
    return this.getArticles({
      ...params,
      search: query,
    });
  }
}
