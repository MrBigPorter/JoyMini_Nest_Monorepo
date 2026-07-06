🔥 超浓缩记忆版（容器内一律从 /app + workspace）

## ⛔ 绝对禁止

| ❌ 禁止命令 | 原因 |
|------------|------|
| `prisma migrate reset` | **删除整个数据库所有表！** —— 会丢失所有生产/开发数据。**绝对不要执行！** |

✅ **正确做法**：如果需要处理某个特定表的变动（如修改数据、重新 seeding），使用目标 SQL 操作：
```sql
-- 只清空特定表（保留其他所有数据）
TRUNCATE TABLE "intent_examples" CASCADE;

-- 或者只修改特定表的数据
DELETE FROM "intent_examples" WHERE domain = 'wallet';
```
然后用 `prisma migrate dev --name <变更>` 仅应用 schema 变更，不影响数据。

如果遇到迁移冲突（已有迁移被修改后无法应用）：
```
prisma migrate dev --create-only --skip-generate --name <变更>
prisma migrate resolve --applied <迁移名>
```
这样创建新迁移文件并标记为已应用，**不会动数据库数据**。


前提约定（记这个）：
• 容器名：lucky-backend-dev
• 容器代码根：/app
• API 包：@lucky/api
• Prisma schema：apps/api/prisma/schema.prisma
• 所有命令格式：

docker exec -it lucky-backend-dev sh -lc "cd /app && <命令>"

1. 生成类型：prisma generate
2. 开发改表：prisma migrate dev --name <变更>
3. 部署执行：prisma migrate deploy
4. 开发重置：prisma migrate reset --force --skip-seed

1）第一次初始化（空库或可清空的开发库）

1.1 生成 Client（类型）

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api prisma generate --schema prisma/schema.prisma"

1.2 创建并应用首个迁移（把 schema 真正写入 DB）

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api prisma migrate dev --name init --schema prisma/schema.prisma"

1.3 验证模型是否生成成功（应能看到 treasure 等）
docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
node -e \"const { PrismaClient } = require('@lucky/api/node_modules/@prisma/client'); const p = new PrismaClient(); console.log(Object.keys(p).filter(k => typeof p[k]?.findMany === 'function'));\""

2）日常开发（改表、加字段、索引）

每次修改 apps/api/prisma/schema.prisma 后：

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api prisma migrate dev --name <你的变更名> --schema prisma/schema.prisma && \
yarn workspace @lucky/api prisma generate --schema prisma/schema.prisma"

3）上线 / CI（只执行已存在迁移）

部署环境（已有数据的正式库）：

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api prisma migrate deploy --schema prisma/schema.prisma && \
yarn workspace @lucky/api prisma generate --schema prisma/schema.prisma"

4）常见场景 & 故障恢复

4.A ⛔ ~~开发库重置（可清空时用）~~ — **绝对禁止使用 `prisma migrate reset`**
    
    ❌ 不要这样做：`prisma migrate reset --force` → 删除全部表，丢失所有数据
    
    ✅ 正确做法：只操作需要的特定表
    ```sql
    -- 清空特定表（保留其他表数据）
    TRUNCATE TABLE "intent_examples" CASCADE;
    TRUNCATE TABLE "intent_classification_logs" CASCADE;
    ```

4.B 已有线上数据库接入（Baseline 基线迁移）

当数据库已有表结构，但 prisma/migrations 为空或不一致时：

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
cd apps/api && \
mkdir -p prisma/migrations/BASELINE && \
yarn prisma migrate diff \
--from-empty \
--to-schema-datamodel prisma/schema.prisma \
--script > prisma/migrations/BASELINE/migration.sql && \
yarn prisma migrate resolve --applied BASELINE --schema prisma/schema.prisma && \
yarn prisma migrate status --schema prisma/schema.prisma"

5）用 postgres 超级用户给 dev 开权限
docker exec -it lucky-db psql -U postgres -d postgres -c "ALTER ROLE dev WITH CREATEDB;"
