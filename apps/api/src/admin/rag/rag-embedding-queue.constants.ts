/**
 * Rag Embedding Queue — BullMQ 队列常量
 *
 * 这个队列专门用于知识库文档 chunk 的向量化（embedding）任务。
 * 与 common/ai/queues/embedding/ 中的 EMBEDDING_QUEUE（用于 Intent Examples）是独立的。
 *
 * 为什么独立？
 *   - Intent Examples 的 embedding 是"一句一 job"，数据量小但频繁
 *   - 知识库 chunk 的 embedding 是"一篇文档一 job"，数据量大但低频
 *   - 独立队列可以分别控制 concurrency，互不影响
 */
export const RAG_EMBEDDING_QUEUE = 'rag-embedding';
