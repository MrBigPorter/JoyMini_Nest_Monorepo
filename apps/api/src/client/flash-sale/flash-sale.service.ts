import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';

@Injectable()
export class ClientFlashSaleService {
  constructor(private readonly prisma: PrismaService) {}

  private mapSession(
    session: {
      id: string;
      title: string;
      startTime: Date;
      endTime: Date;
      status: number;
      _count?: { products: number };
    },
    nowMs: number,
  ) {
    return {
      id: session.id,
      title: session.title,
      startTime: session.startTime.getTime(),
      endTime: session.endTime.getTime(),
      status: session.status,
      productCount: session._count?.products ?? 0,
      remainingMs: Math.max(0, session.endTime.getTime() - nowMs),
    };
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0,
    );
  }

  async getActiveSessions() {
    const now = new Date();
    const nowMs = now.getTime();

    const sessions = await this.prisma.flashSaleSession.findMany({
      where: {
        status: 1,
        startTime: { lte: now },
        endTime: { gte: now },
      },
      orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }],
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    return {
      list: sessions.map((session: any) => this.mapSession(session, nowMs)),
    };
  }

  async getSessionProducts(sessionId: string) {
    const now = new Date();
    const nowMs = now.getTime();

    const session = await this.prisma.flashSaleSession.findFirst({
      where: {
        id: sessionId,
        status: 1,
        startTime: { lte: now },
        endTime: { gte: now },
      },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Flash sale session not found or not active');
    }

    const products = await this.prisma.flashSaleProduct.findMany({
      where: { sessionId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        treasure: {
          select: {
            treasureId: true,
            treasureName: true,
            productName: true,
            treasureCoverImg: true,
            unitAmount: true,
            marketAmount: true,
          },
        },
      },
    });

    return {
      session: this.mapSession(session, nowMs),
      list: products.map((product: any) => ({
        id: product.id,
        sessionId: product.sessionId,
        treasureId: product.treasureId,
        flashStock: product.flashStock,
        flashPrice: product.flashPrice.toString(),
        sortOrder: product.sortOrder,
        isSoldOut: product.flashStock <= 0,
        product: {
          treasureId: product.treasure.treasureId,
          treasureName: product.treasure.treasureName,
          productName: product.treasure.productName,
          treasureCoverImg: product.treasure.treasureCoverImg,
          unitAmount: product.treasure.unitAmount.toString(),
          marketAmount: product.treasure.marketAmount?.toString() ?? null,
        },
      })),
    };
  }

  async getProductDetail(productId: string) {
    const now = new Date();
    const nowMs = now.getTime();

    const product = await this.prisma.flashSaleProduct.findFirst({
      where: {
        id: productId,
        session: {
          status: 1,
          startTime: { lte: now },
          endTime: { gte: now },
        },
      },
      include: {
        session: {
          include: {
            _count: {
              select: { products: true },
            },
          },
        },
        treasure: {
          select: {
            treasureId: true,
            treasureSeq: true,
            treasureName: true,
            productName: true,
            treasureCoverImg: true,
            mainImageList: true,
            unitAmount: true,
            marketAmount: true,
            desc: true,
            ruleContent: true,
            shippingType: true,
            groupSize: true,
            state: true,
            salesStartAt: true,
            salesEndAt: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Flash sale product not found or not active');
    }

    return {
      id: product.id,
      sessionId: product.sessionId,
      treasureId: product.treasureId,
      flashStock: product.flashStock,
      flashPrice: product.flashPrice.toString(),
      sortOrder: product.sortOrder,
      isSoldOut: product.flashStock <= 0,
      session: this.mapSession(product.session, nowMs),
      product: {
        treasureId: product.treasure.treasureId,
        treasureSeq: product.treasure.treasureSeq,
        treasureName: product.treasure.treasureName,
        productName: product.treasure.productName,
        treasureCoverImg: product.treasure.treasureCoverImg,
        mainImageList: this.toStringArray(product.treasure.mainImageList),
        unitAmount: product.treasure.unitAmount.toString(),
        marketAmount: product.treasure.marketAmount?.toString() ?? null,
        desc: product.treasure.desc,
        ruleContent: product.treasure.ruleContent,
        shippingType: product.treasure.shippingType,
        groupSize: product.treasure.groupSize,
        state: product.treasure.state,
        salesStartAt: product.treasure.salesStartAt?.getTime() ?? null,
        salesEndAt: product.treasure.salesEndAt?.getTime() ?? null,
      },
    };
  }
}
