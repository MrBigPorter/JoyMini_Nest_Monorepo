import { Module, Global } from '@nestjs/common';
import { MeilisearchService } from './meilisearch.service';

/**
 * MeilisearchModule — 全局 Meilisearch 客户端模块。
 *
 * 为什么是 Global？
 *   RagRetrievalService 和 EmbeddingProcessor 都需要注入 MeilisearchService，
 *   设为 Global 后无需在每个使用模块中重复导入。
 *
 * 为什么独立成模块而不是直接写在 RagRetrievalService 里？
 *   1. 关注点分离：Meilisearch 客户端初始化、连接管理、索引管理都在这里
 *   2. 可测试性：可以单独 mock MeilisearchService
 *   3. 可替换性：未来换其他搜索引擎只需改这一个模块
 */
@Global()
@Module({
  providers: [MeilisearchService],
  exports: [MeilisearchService],
})
export class MeilisearchModule {}
