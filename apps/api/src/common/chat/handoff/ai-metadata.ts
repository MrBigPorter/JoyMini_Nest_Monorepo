import type { PrismaService } from '@api/common/prisma/prisma.service';

/**
 * aiMetadata 的原子写入。
 *
 * 多个路径都会写同一份 JSON（转人工 callback、复位标记、生命周期审计）。
 * 读-改-写会丢键，这里统一用 Postgres jsonb 操作，在一条 UPDATE 里完成。
 */
type Db = Pick<PrismaService, '$executeRaw'>;

export interface HandoffCallback {
  status: 'pending' | 'handled';
  requestedAt: string;
  reason: string;
}

export async function setHandoffCallbackPending(
  db: Db,
  conversationId: string,
  reason: string,
  requestedAt: Date,
): Promise<void> {
  const callback: HandoffCallback = {
    status: 'pending',
    requestedAt: requestedAt.toISOString(),
    reason,
  };
  await db.$executeRaw`
    UPDATE "Conversation"
    SET "ai_metadata" = jsonb_set(
      COALESCE("ai_metadata", '{}'::jsonb),
      '{handoffCallback}',
      ${JSON.stringify(callback)}::jsonb,
      true
    )
    WHERE "id" = ${conversationId}
  `;
}

export async function markHandoffCallbackHandled(
  db: Db,
  conversationId: string,
): Promise<number> {
  return db.$executeRaw`
    UPDATE "Conversation"
    SET "ai_metadata" = jsonb_set(
      "ai_metadata",
      '{handoffCallback,status}',
      '"handled"'::jsonb,
      true
    )
    WHERE "id" = ${conversationId}
      AND "ai_metadata" #>> '{handoffCallback,status}' = 'pending'
  `;
}

/** 仅当标记仍是这个值时删除，返回受影响行数（0/1）。 */
export async function consumeHandoffResetFlag(
  db: Db,
  conversationId: string,
  flag: unknown,
): Promise<number> {
  return db.$executeRaw`
    UPDATE "Conversation"
    SET "ai_metadata" = COALESCE("ai_metadata", '{}'::jsonb) - 'handoffResetPending'
    WHERE "id" = ${conversationId}
      AND "ai_metadata" -> 'handoffResetPending' = ${JSON.stringify(flag)}::jsonb
  `;
}
