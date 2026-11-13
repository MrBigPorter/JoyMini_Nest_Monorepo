# Claude Code 配置方案（Hook / Subagent / MCP）

> 建立于: 2026-11-14
> 适用: 本仓库 `.claude/settings.json` + 开发者本机
> 目标: 把「靠 AI 自觉」的部分改成「靠机制保证」

---

## 0. 设计原则

**能力边界落在机制上，不落在自觉上。**

同一件事有三种做法，可靠性从低到高：

| 做法 | 谁保证 | 可靠性 |
|------|--------|--------|
| 写进 CLAUDE.md「请记得…」 | AI 自觉 | 低 |
| 写进 skill「按这个流程做」 | AI 判断后执行 | 中 |
| 写进 hook / permissions / 工具白名单 | harness 强制执行 | 高 |

本方案只做第三层能做的事。

---

## 1. 现状（配置前）

| 项 | 状态 |
|----|------|
| `.claude/settings.json` | 存在，只配了 10 个 skill |
| hooks | 无 |
| permissions | 无（每条命令都需要人工确认） |
| 自建 agent | 无 |
| MCP server | 无 |
| `.env` 文件 | 8 个（含生产配置），AI 可任意读取 |

---

## 2. Hook 配置

hook 是 harness 在固定时机自动执行的 shell 命令，**不经过模型判断**。
`exit 2` 表示拦截，并把 stderr 回传给模型。

### 2.1 SessionStart —— 开工自动进入状态

每次会话开始打印当前任务与分支，省掉「先读 current-task.md」这句话。

```json
{
  "SessionStart": [{
    "hooks": [{
      "type": "command",
      "command": "echo '=== 任务 ==='; head -16 docs/current-task.md; echo; echo '=== 分支 ==='; git branch --show-current; git status --short"
    }]
  }]
}
```

### 2.2 PreToolUse —— 拦截危险命令

`.claude/hooks/guard.sh`，命中即 `exit 2`。

覆盖：
- `prisma migrate reset` / `make pr:m:reset` → 会清空本地库
- `git push --force` / `-f` → 强推
- `rm -rf /` / `rm -rf ~` → 灾难命令

```json
{
  "PreToolUse": [{
    "matcher": "Bash",
    "hooks": [{ "type": "command", "command": ".claude/hooks/guard.sh" }]
  }]
}
```

### 2.3 PostToolUse —— 写完自动格式化

只处理 `.ts/.tsx/.js/.jsx/.json`，输出丢弃（避免污染上下文）。

```json
{
  "PostToolUse": [{
    "matcher": "Edit|Write",
    "hooks": [{
      "type": "command",
      "command": "f=$(jq -r '.tool_input.file_path'); case \"$f\" in *.ts|*.tsx|*.js|*.jsx|*.json) yarn prettier --write \"$f\" >/dev/null 2>&1;; esac"
    }]
  }]
}
```

### 2.4 hook 的适用范围（重要）

> **hook 只在开发者本机生效。CI、同事的机器、其他 IDE 都不跑。**

所以 hook 兜的是「AI 犯错的概率」，不是「系统的正确性」。
真正的质量防线仍然在 CI 的 lint / test / check-types。

### 2.5 刻意不配的 hook

| 不配 | 原因 |
|------|------|
| Stop 跑全量 `check-types` | turbo 跨包，一轮十几到几十秒，每轮回答都等 |
| Stop 跑全量测试 | 更慢，且测试属于 CI 职责 |
| PreCompact 存档 | 当前会话长度未到需要干预的程度 |

---

## 3. Permissions 配置

### 3.1 deny —— 读写禁区

```json
{
  "deny": [
    "Read(./**/.env)",
    "Read(./**/.env.local)",
    "Read(./**/.env.production)",
    "Read(./**/.env.development)",
    "Read(./deploy/.env.*)",
    "Bash(rm -rf:*)",
    "Bash(git push --force:*)",
    "Bash(git push -f:*)",
    "Bash(prisma migrate reset:*)",
    "Bash(npx prisma migrate reset:*)",
    "Bash(yarn pr:m:reset)",
    "Bash(make pr:m:reset)"
  ]
}
```

注意：
- `.env.example` **不拦**（模板，应该能读）
- deny **优先于** allow
- 生产凭据文件（`deploy/.env.prod`）由 `Read(./deploy/.env.*)` 覆盖

### 3.2 allow —— 高频免确认

```json
{
  "allow": [
    "Bash(git status)", "Bash(git diff:*)", "Bash(git log:*)",
    "Bash(git branch:*)", "Bash(yarn:*)", "Bash(make:*)",
    "Bash(docker ps:*)", "Bash(docker logs:*)", "Bash(colima status)"
  ]
}
```

原则：只放行真正高频的。放行太宽等于没配。

### 3.3 additionalDirectories —— 跨目录访问

Flutter 项目不在工作目录内：

```json
{ "additionalDirectories": ["/Users/porter/Developer/JoyMini_Flutter_App"] }
```

---

## 4. Subagent 配置

### 4.1 只建一个：security-auditor

`.claude/agents/security-auditor.md`

**关键在 `tools:` 只声明 `Read, Grep, Glob`** —— 它物理上就没有写权限，
这是能力限制，不是口头约束。

审查重点对齐本仓库的实际风险面：
1. 越权（资源归属校验、guard 绕过）
2. 并发（优惠券 / 积分 / 库存超领窗口）
3. 凭据（密钥进日志或响应体）
4. 限流（SSE / 登录 / 领券的 Redis 限流）

### 4.2 其余不自建

内置 `Explore`（只读定位）、`Plan`（方案设计）已覆盖绝大部分场景。
自建 agent 越多，维护成本和误派遣概率越高。

### 4.3 使用纪律

- 只读 agent（Explore / Plan / security-auditor）→ 可放心派遣
- 有写权限的 agent（general-purpose）→ 派完必须 `git status --short` 核对副作用

---

## 5. MCP 配置

### 5.1 Postgres（第一优先）

**收益**：AI 可自行验证字段取值、索引是否生效、数据形态，无需人工贴 SQL。

**状态：已配置完成（2026-11-14）**

- 数据库：`joy_mini`（容器 `lucky-db`，pgvector 0.8.5，72 张表）
- 角色：`mcp_ro`，仅 `SELECT`
- 验证：读 72 表通过；`CREATE TABLE` 被拒；`DELETE` 被拒
- 连接串已写入 `~/.zshrc`（标记块 `# --- JoyMini: Claude Code MCP 只读数据库账号 ---`）

以下为创建步骤记录，供重建时使用：

1. 创建只读角色：

```sql
CREATE ROLE mcp_ro LOGIN PASSWORD '<随机强密码>';
GRANT CONNECT ON DATABASE joy_mini TO mcp_ro;
GRANT USAGE ON SCHEMA public TO mcp_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mcp_ro;
```

2. 在 `~/.zshrc` 导出连接串（**不要写进 `.mcp.json`，那是要提交的**）：

```bash
export JOYMINI_DEV_DB_URL='postgresql://mcp_ro:<密码>@localhost:5432/joy_mini'
```

3. `.mcp.json`（可提交，只含变量引用）：

```json
{
  "mcpServers": {
    "postgres-dev": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "${JOYMINI_DEV_DB_URL}"]
    }
  }
}
```

**红线：永不接生产库。** MCP server 拿到的是数据库全权限，
只读角色是唯一可靠的兜底。

### 5.2 Redis（第二优先，按需）

```json
{
  "redis-dev": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-redis", "redis://localhost:6379"]
  }
}
```

### 5.3 MCP 的隐藏成本

> 工具定义**常驻上下文**，用不用都占窗口。

接 3 个 server × 10 个工具 ≈ 30 份工具说明常驻。
原则：**接了不用就是纯亏**，逐个启用，观察两周再加下一个。

---

## 6. 生效与验证

| 配置 | 如何验证 |
|------|----------|
| hooks | 新会话开始应自动打印任务与分支 |
| permissions | 让 AI 读 `apps/api/.env`，应被拒绝 |
| PreToolUse | 让 AI 跑 `make pr:m:reset`，应被拦截并给出理由 |
| PostToolUse | 让 AI 改一个 `.ts` 文件，文件应被自动格式化 |
| skill `check` | 输入 `/check` 或说「跑一遍 check」 |
| agent | 问「有哪些 agent 类型」，看是否出现 security-auditor |
| MCP | `/mcp` 查看连接状态；失败先查 `JOYMINI_DEV_DB_URL` 是否已 export |

---

## 7. 回滚

所有改动集中在以下几处，删除即回滚：

1. `.claude/settings.json` 中的 `permissions` / `hooks` / `skills.check`
2. `.claude/hooks/guard.sh`
3. `.claude/agents/security-auditor.md`
4. `.mcp.json`（如已创建）

---

## 8. 已知限制

| 限制 | 影响 | 缓解 |
|------|------|------|
| hook 仅本机生效 | 同事 / CI 无此保护 | 质量防线放 CI |
| hook 增加每次编辑延迟 | prettier 单文件约 200-500ms | 仅处理 5 类扩展名 |
| subagent 过程不可见 | 有写权限的 agent 可能静默改文件 | 只在只读场景派遣，或派完查 git status |
| MCP 占上下文 | 工具定义常驻 | 按需逐个启用 |
| 配置项支持度依赖 harness 版本 | 个别项可能不生效 | 按第 6 节逐项验证 |

---

## 9. 日常使用

### 9.1 不需要操心的（已自动化）

| 机制 | 何时发生 | 你要做什么 |
|------|----------|-----------|
| SessionStart | 每次开会话 | 无，自动打印任务 + 分支 + 改动 |
| PostToolUse | 每次改 `.ts/.tsx/.js/.jsx/.json` | 无，自动 prettier |
| PreToolUse | 每次执行 Bash | 无，危险命令自动拦截 |
| permissions | 每次读文件 / 跑命令 | 无，`.env` 读不到，高频命令免确认 |

### 9.2 一句话触发

| 想做什么 | 怎么说 | 结果 |
|----------|--------|------|
| 提交前检查 | `/check` 或「跑一遍 check」 | 类型 + lint + 9 维规范自查 |
| 安全审计 | 「用 security-auditor 审一下支付流程」 | 只读 agent 报 P0/P1 |
| 查数据库 | 「查一下 orders 表这周有多少条」 | MCP 直查，只读 |
| 看索引 | 「users 表有哪些索引」 | 查 `pg_indexes` |
| 验数据形态 | 「coupon 的 status 实际有哪些值」 | `GROUP BY` 后回报 |
| 定位代码 | 「这个逻辑在哪些文件里」 | Explore 只回摘要 |
| 先设计后动手 | 「先出方案别改代码」 | Plan / plan 模式 |

### 9.3 典型流程

```
开工   → 新会话，自动带出任务与分支
写码   → 直接说改什么；格式化自动完成
验数据 → 直接问结论，不用贴 SQL
提交前 → /check
待审码 → 派 security-auditor
收工   → 让 AI 提交
```

### 9.4 使用要点

1. **`/check` 不要频繁跑**：`yarn check-types` 走 turbo 跨包，一次十几到几十秒，提交前一次即可。
2. **审计要给范围**：说 `apps/api/src/client/coupon/`，不要说「审整个项目」。
3. **查库问结论，不问 SQL**：问「订单为什么跌」，不要求「把 SQL 写给我」。
4. **`.env` 读不到是预期行为**：需要配置值时由人转述，不要为方便而删除 deny 规则。

### 9.5 修改与关闭

| 想做的事 | 改哪 |
|----------|------|
| 调整拦截规则 | `.claude/hooks/guard.sh` |
| 增减免确认命令 | `.claude/settings.json` → `permissions.allow` |
| 换格式化工具 | `settings.json` → `hooks.PostToolUse` |
| 临时关闭所有 hook | 删除 `settings.json` 的 `hooks` 块 |
| 查看 MCP 状态 | `/mcp` |
| 停用 MCP | 删除 `.mcp.json` |
| 删除只读角色 | `DROP ROLE mcp_ro;` |

### 9.6 迁移到其他项目

最小集合（去掉项目专属内容后）：

```
.claude/hooks/guard.sh        # 最通用，命令规则与项目无关
.claude/settings.json         # 只抄 permissions 与 hooks 两块
docs/claude-code-config.md    # 说明文档，改掉库名即可
```

迁移方式按成本递增：复制目录 → 放进脚手架模板 → 打包成 plugin marketplace。
**两个项目以内直接复制**，出现第三个且反复手工拷贝时再做 plugin。
