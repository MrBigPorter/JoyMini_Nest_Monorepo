-- 判官身份随运行留存：prompt 指纹 + 实际使用的模型/供应商
--
-- 与 20261125150000_eval_run_integrity 同属 D5（判官标准版本化）。
-- 二者拆开是因为第一支迁移已在本地下发；追加一支可空列迁移对已跑过的环境安全，
-- 也保留迁移历史与制品一致。全部可空，回滚时保留列即可，代码回退不受影响。

ALTER TABLE "ai_eval_runs"
  ADD COLUMN IF NOT EXISTS "judge_prompt_hash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "judge_model" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "judge_vendor" VARCHAR(32);
