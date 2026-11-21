-- 对齐 Prompt 覆盖命名：历史行名 `wallet-agent`，代码按 tag `wallet` 查找。
-- 只改名称和英文语言约束，不动其他自定义字段。

UPDATE "knowledge_prompts" SET "name" = 'wallet' WHERE "name" = 'wallet-agent';
UPDATE "knowledge_prompts" SET "name" = 'coupon' WHERE "name" = 'coupon-agent';
UPDATE "knowledge_prompts" SET "name" = 'order' WHERE "name" = 'order-agent';
UPDATE "knowledge_prompts" SET "name" = 'product' WHERE "name" = 'product-agent';
UPDATE "knowledge_prompts" SET "name" = 'user' WHERE "name" = 'user-agent';
UPDATE "knowledge_prompts" SET "name" = 'kyc' WHERE "name" = 'kyc-agent';

-- 去掉 role 里的硬编码英文约束。
UPDATE "knowledge_prompt_versions"
SET "config" = jsonb_set(
  "config",
  '{role}',
  to_jsonb(regexp_replace("config"->>'role', '\s*Respond in English\.', '', 'g'))
)
WHERE "config" ? 'role'
  AND "config"->>'role' LIKE '%Respond in English%';

-- workflow 里的 Step 5 改为跟随用户语言。
UPDATE "knowledge_prompt_versions"
SET "config" = jsonb_set(
  "config",
  '{workflow}',
  to_jsonb(regexp_replace("config"->>'workflow', 'Respond in English', 'Reply in the user''s language', 'g'))
)
WHERE "config" ? 'workflow'
  AND "config"->>'workflow' LIKE '%Respond in English%';
