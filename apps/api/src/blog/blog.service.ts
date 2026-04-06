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
}
