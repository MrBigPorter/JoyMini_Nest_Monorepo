-- These six overrides were seeded in July and shadow the prompts in code.
-- Code prompts have since gained the confirmation-card rules, language fixes
-- and availability filtering, but the DB copies still win at runtime.
-- Deactivate them so the maintained code prompts are the single source.
UPDATE "knowledge_prompts"
SET status = 'inactive', "updatedAt" = now()
WHERE name IN ('coupon', 'kyc', 'lucky-draw', 'order', 'product', 'user')
  AND status = 'active';
