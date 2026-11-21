-- wallet prompt override 是旧版“聊天内收集银行卡号”的规则。
-- 在管理员重新保存安全版本前，先停用它，回退到 TS 默认的安全 wallet prompt。
UPDATE "knowledge_prompts"
SET "status" = 'inactive'
WHERE "name" = 'wallet' AND "status" = 'active';
