-- 解析质量四项检查明细快照：页面展示通过与明细，旧数据为 null 表示未采集。
ALTER TABLE "knowledge_documents"
ADD COLUMN "parse_checks" JSONB;
