-- LangGraph Postgres checkpointer 表（reliable-ai-runtime 1.1）
--
-- 背景：应用启动时 PostgresSaver.setup() 会按需建表，但线上账号往往没有 DDL 权限；
-- 权限不足时 setup() 抛错并被降级为 MemorySaver，会话状态重启即失。
-- 因此把最终结构固化进迁移，并把包内 6 条增量迁移（v0..v5）标记为已应用，
-- 使 setup() 幂等跳过，不再依赖运行时 DDL。
--
-- 结构以 @langchain/langgraph-checkpoint-postgres@1.1.4 的 migrations.js 为准：
--   v0 checkpoint_migrations
--   v1 checkpoints
--   v2 checkpoint_blobs
--   v3 checkpoint_writes
--   v4 checkpoint_blobs.blob DROP NOT NULL
--   v5 checkpoint_writes.task_path TEXT NOT NULL DEFAULT ''
--
-- 使用 IF NOT EXISTS / IF NOT EXISTS 列，兼容已经由 setup() 建过表的库。

CREATE TABLE IF NOT EXISTS "checkpoint_migrations" (
  v INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS "checkpoints" (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS "checkpoint_blobs" (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  blob BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE IF NOT EXISTS "checkpoint_writes" (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  blob BYTEA NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

ALTER TABLE "checkpoint_blobs" ALTER COLUMN blob DROP NOT NULL;
ALTER TABLE "checkpoint_writes" ADD COLUMN IF NOT EXISTS task_path TEXT NOT NULL DEFAULT '';

-- 标记包内 6 条迁移已应用，setup() 启动时无需再执行任何 DDL。
INSERT INTO "checkpoint_migrations" (v)
VALUES (0), (1), (2), (3), (4), (5)
ON CONFLICT (v) DO NOTHING;
