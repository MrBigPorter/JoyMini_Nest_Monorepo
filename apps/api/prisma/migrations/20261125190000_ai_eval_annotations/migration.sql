-- 标注落库（替代每管理员一份 JSONL 的写入源）。
-- `run_id` 是作用域：评测运行写真实 run id，离线工作表写 `worksheet:<文件名>`；
-- 预标注固定 labeler_id='prelabel'，与人工标注并存。
-- 不做历史 JSONL 导入：旧文件保留为导出格式，新写入只走这张表。
CREATE TABLE "ai_eval_annotations" (
    "id" VARCHAR(32) NOT NULL,
    "run_id" VARCHAR(128) NOT NULL,
    "case_id" VARCHAR(64) NOT NULL,
    "turn" INTEGER NOT NULL DEFAULT 0,
    "labeler_id" VARCHAR(64) NOT NULL,
    "correctness" VARCHAR(16),
    "comment" VARCHAR(500) NOT NULL DEFAULT '',
    "guideline_version" VARCHAR(64) NOT NULL,
    "source" VARCHAR(16) NOT NULL DEFAULT 'human',
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_eval_annotations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_ai_eval_annotation_scope_case_turn_labeler"
  ON "ai_eval_annotations"("run_id", "case_id", "turn", "labeler_id");

CREATE INDEX "ai_eval_annotations_run_id_case_id_idx"
  ON "ai_eval_annotations"("run_id", "case_id");
