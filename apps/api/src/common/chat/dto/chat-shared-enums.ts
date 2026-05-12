// apps/api/src/common/chat/dto/chat-shared-enums.ts
/**
 * Re-exports + local const arrays for @lucky/shared enums used in Chat DTOs.
 *
 * WHY this file exists:
 *   The @nestjs/swagger CLI plugin resolves TypeScript `enum` identifiers via
 *   ts-morph, tracing through ALL re-exports to the original declaration.
 *   For workspace packages the generated require() path is computed from the
 *   SOURCE file depth but written into the COMPILED dist/ — which is one level
 *   deeper due to `outDir: "./dist"`. Result: always one `../` short.
 *
 *   FIX: pass a plain `const string[]` to @ApiProperty({ enum: ... }).
 *   The plugin does NOT trace const arrays — it uses the value as-is.
 */
export { ChatMemberRole } from '@lucky/shared'; // type-only, do NOT pass to @ApiProperty enum

/** Pass to @ApiProperty({ enum: CHAT_MEMBER_ROLE_VALUES }) instead of the enum class. */
export const CHAT_MEMBER_ROLE_VALUES = ['OWNER', 'ADMIN', 'MEMBER'] as const;

/**
 * Prisma ConversationType enum values as a const array.
 *
 * Avoids runtime dependency on the Prisma client enum, which is undefined
 * when loaded via ts-node (e.g., swagger export CLI script).
 *
 * Match this to apps/api/prisma/schema.prisma enum ConversationType.
 */
export const CONVERSATION_TYPE_VALUES = ['GROUP', 'DIRECT', 'SUPPORT', 'BUSINESS'] as const;
