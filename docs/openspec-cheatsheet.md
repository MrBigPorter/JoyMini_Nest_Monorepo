# OpenSpec 操作手册

> 版本：2.0.0（npm 全局安装，`~/.volta/bin/openspec`）
> 更新：2026-11-14
> 所有命令均对照 `openspec <cmd> --help` 实际输出核实。

---

## 一、心智模型：三个时态

```
openspec/
  specs/                     ← 现在时：系统"已经生效"的行为契约
  changes/<name>/            ← 将来时：还没生效的变更提案
  changes/archive/           ← 完成时：改完归档的历史
```

三条铁律：

1. **specs 只描述行为，不描述实现**。写"用户能导出 CSV"，不写"用 Papa.unparse 转"。
2. **changes 是 delta，不是全文**。只写"新增/修改/删除哪几条要求"。
3. **只有 archive 才把 delta 合并进 specs**。所以 specs 永远是"已上线的现实"。

> **判断某个东西该不该进 specs**：如果实现方式可以随便换、对外表现不变，那它就不该进 specs。

### 一个 change 的四个产物

| 文件 | 回答 | 内容 |
|---|---|---|
| `proposal.md` | 为什么改 / 改什么 | Why / What Changes / Capabilities / Impact |
| `specs/<capability>/spec.md` | 承诺变成什么样 | Delta：ADDED / MODIFIED / REMOVED / RENAMED |
| `design.md` | 怎么做 | Context / Goals / Decisions / Risks / Migration |
| `tasks.md` | 分几步做 | `- [ ]` 勾选项，apply 阶段按这个跟踪 |

`specs/` 是唯一**必填**的行为产物；`design.md` 在 schema 里是条件性产物（纯配置/小改动可省）。

---

## 二、速查表：我想做什么 → 用什么命令

| 我想… | 命令 |
|---|---|
| 看系统有哪些能力 | `openspec list --specs` |
| 看正在改什么 | `openspec list` |
| 看改完的历史 | `openspec list --archived` |
| 看某个变更的动机 | `openspec show <change>` |
| 看某个变更的验收标准 | `openspec show <change> --json --deltas-only` |
| 看某个能力的完整规格 | `openspec show <spec-id> --type spec` |
| 看变更做到哪一步了 | `openspec status --change <change>` |
| 新建一个变更 | `openspec new change <name>` |
| 写某一类产物前查规范 | `openspec instructions <artifact> --change <name> --json` |
| 校验写得对不对 | `openspec validate <change> --strict` |
| 全量体检 | `openspec validate --all --strict` |
| 完工归档 | `openspec archive <change>` |
| 看交互式面板 | `openspec view` |
| 确认项目根在哪 | `openspec context --json` |
| 查引用关系是否健康 | `openspec doctor` |
| 加/减可用工作流 | `openspec config profile` |

---

## 三、标准工作流（propose → apply → archive）

### 阶段 1：提案

```bash
# 1. 确认根目录
openspec context --json

# 2. 看看已有能力，避免起重复名字
openspec list --specs

# 3. 建变更（名字用 kebab-case）
openspec new change unify-intent-thresholds

# 4. 看依赖图，知道先写哪份
openspec status --change unify-intent-thresholds --json

# 5. 每份产物写之前，先取说明书
openspec instructions proposal --change unify-intent-thresholds --json
openspec instructions specs    --change unify-intent-thresholds --json
openspec instructions design   --change unify-intent-thresholds --json
openspec instructions tasks    --change unify-intent-thresholds --json

# 6. 每写完一份，复查状态
openspec status --change unify-intent-thresholds

# 7. 严格校验
openspec validate unify-intent-thresholds --strict
```

**依赖顺序是硬性的**：

```
proposal ──┬─→ specs ──┐
           └─→ design ─┴─→ tasks
```

`tasks` 必须等 `specs` 和 `design` 都完成。这不是约定，`status` 会显示 `blocked`。

### 阶段 2：实施

```bash
# 看实施指引
openspec instructions apply --change unify-intent-thresholds --json
```

在 Claude Code 里直接用 skill：

```
/openspec-apply-change
```

按 `tasks.md` 逐条勾选。**勾选格式**：`- [x]` 才算完成，`- [~]`、`- [-]`、`- []` 全部算未完成。

### 阶段 3：归档

```bash
# 先校验（含"归档变更必须所有任务已完成"）
openspec validate --archived

# 归档并合并 delta 进 specs
openspec archive unify-intent-thresholds -y

# 跳过规格更新（纯工具链/文档类变更）
openspec archive <change> --skip-specs
```

归档后 `openspec/specs/<capability>/spec.md` 才会真正出现。

---

## 四、命令详解

### 4.1 初始化与维护

```bash
openspec --version                    # 看版本
openspec version                      # 版本 + 是否有新版
openspec init [path]                  # 初始化项目
openspec init --tools claude --language zh-CN --no-animation
openspec update [path]                # 刷新生成的 skills
openspec update --dry-run --json      # 只报告会改什么
openspec install [version]            # 安装/替换独立二进制
```

`init --tools` 支持的取值包括 `claude`、`cursor`、`codex`、`gemini`、`github-copilot` 等；`all` 全装，`none` 不装。

### 4.2 读：list / show / view / context / doctor

```bash
# list —— 默认列 changes
openspec list                         # 进行中的变更
openspec list --specs                 # 已有能力
openspec list --archived              # 已归档的变更
openspec list --all                   # 进行中 + 已归档
openspec list --sort name             # 排序：recent（默认）| name
openspec list --json                  # 机器可读

# show —— 摊开单个条目
openspec show <change>                        # markdown，默认给 proposal
openspec show <change> --json                 # 全部产物（JSON）
openspec show <change> --json --deltas-only   # 只看 specs delta
openspec show <change> --json --diff          # 每条 requirement 的差异
openspec show <change> --json --no-scenarios  # 排除场景，只看要求
openspec show <change> --json -r 2            # 只看第 2 条 requirement
openspec show <spec-id> --type spec           # 看已归档的主规格

# 其它
openspec view                         # 交互式面板（specs + changes）
openspec context --json               # 打印工作上下文，确认 root 路径
openspec doctor --json                # 引用关系健康检查
```

⚠️ `--deltas-only`、`--diff`、`--requirements`、`-r` 这些**必须配 `--json`**，单独用会退化成 markdown 全文。

### 4.3 写：new / instructions

```bash
openspec new change <name>                       # 建变更目录
openspec new change <name> --schema spec-driven  # 指定工作流

openspec instructions proposal --change <name> --json
openspec instructions specs    --change <name> --json
openspec instructions design   --change <name> --json
openspec instructions tasks    --change <name> --json
openspec instructions apply    --change <name> --json
openspec instructions archive  --change <name> --json
```

`instructions --json` 返回的字段各管一件事：

| 字段 | 用途 |
|---|---|
| `instruction` | 这份产物该怎么写（权威，别凭记忆） |
| `template` | 骨架 |
| `context` | 项目级约束（本项目为 `zh-CN`：中文写作，`SHALL/MUST` 保留英文） |
| `rules` | 该类产物的额外规则 |
| `resolvedOutputPath` | 写到哪个路径，别自己拼 |
| `dependencies` | 写完前要读哪些已完成产物 |
| `skipped` / `warning` | 出现则说明这份**不该写**（如 `skip_specs`） |

### 4.4 状态与校验

```bash
openspec status --change <name>          # 人对读的进度
openspec status --change <name> --json   # 依赖图 + 各产物状态
openspec status --all                    # 所有进行中的变更

openspec validate <change>               # 普通校验
openspec validate <change> --strict      # 严格校验（推荐）
openspec validate --all --strict         # 全量
openspec validate --changes              # 只验变更
openspec validate --specs                # 只验规格
openspec validate --archived             # 归档前 lint：任务必须全勾
openspec validate <change> --json --report findings
```

**普通校验放过、`--strict` 才拦的两件事**：

1. requirement 描述超过 500 字符
2. scenario 缺少 WHEN 或 THEN

所以习惯上**永远跑 `--strict`**。

### 4.5 归档

```bash
openspec archive <change>
openspec archive <change> -y             # 跳过确认
openspec archive <change> --skip-specs   # 不更新主规格
openspec archive <change> --no-validate  # 跳过校验（不推荐）
openspec archive <change> --json         # 非交互
```

### 4.6 配置与工作流

```bash
openspec config path             # 全局配置文件位置
openspec config list             # 当前设置
openspec config get <key>        # 读单个值（原始输出，可脚本化）
openspec config set <key> <val>  # 写
openspec config unset <key>      # 还原
openspec config reset            # 全部重置
openspec config edit             # 用 $EDITOR 打开
openspec config profile          # 交互式选工作流档位
```

**档位差异**：

| profile | 提供的工作流 |
|---|---|
| `core`（默认） | `propose`、`explore`、`apply`、`update`、`sync`、`archive` |
| `custom` | 在 core 基础上可加 `new`、`continue`、`ff`、`bulk-archive`、`verify`、`onboard` |

- `explore` —— 动手前的思考伙伴，澄清需求
- `onboard` —— 新人快速理解项目
- `verify` —— 校验实现与规格是否一致
- `bulk-archive` —— 批量归档

### 4.7 进阶：schema / store

```bash
# schema（实验性）
openspec schemas                                    # 列出可用工作流
openspec schema which <name>                        # 这个 schema 从哪加载
openspec schema fork <source> [name]                # 复制一份到项目里改
openspec schema init <name>                         # 新建本地 schema
openspec schema validate <name>                     # 校验 schema

# store（多仓库共享规格）
openspec store setup [id]          # 建并注册一个本地 store
openspec store register <path>     # 注册已有目录
openspec store list                # 列出已注册
openspec store unregister <id>     # 取消注册，不删文件
openspec store remove <id>         # 取消注册并删目录
openspec store doctor [id]
```

命中 store 后，读写类命令都要带 `--store <id>`，且**后续命令要保持粘性**。

### 4.8 其它

```bash
openspec completion install        # 装 shell 补全
openspec completion generate zsh   # 输出到 stdout
openspec workset                   # 个人工作视图（纯本地）
openspec feedback "<消息>"          # 提交反馈
```

---

## 五、产物格式硬规则

### 5.1 四种 delta 操作

```markdown
## ADDED Requirements      ← 新能力
## MODIFIED Requirements   ← 改已有行为，必须贴「完整」新内容
## REMOVED Requirements    ← 必须带 **Reason** 和 **Migration**
## RENAMED Requirements    ← 只改名，用 FROM:/TO:
```

⚠️ **MODIFIED 是最大的坑**：归档时用你写的整块**替换**旧的。只写改动部分，另一半就丢了。

### 5.2 Requirement / Scenario 格式

```markdown
## Purpose                  ← 仅新能力需要，50+ 字符

### Requirement: 用户能导出数据      ← 恰好 3 个 #
系统 SHALL 允许用户导出 CSV。        ← 描述 ≤500 字符，一个 requirement 一个行为

#### Scenario: 成功导出               ← 恰好 4 个 #，3 个或列表会静默失败
- **WHEN** 用户点击导出
- **THEN** 系统下载 CSV
```

**三条硬规则**：

1. `###` 是 requirement，`####` 是 scenario，井号数量错 = 静默失败
2. 每个 scenario 必须有 `WHEN`（触发）+ `THEN`（结果）
3. 每个 requirement 描述 ≤ 500 字符

### 5.3 能力命名

| ❌ 错 | ✅ 对 | 原因 |
|---|---|---|
| `fix-intent-thresholds` | `ai-customer/intent-classification` | 前者是任务，后者是持久行为 |
| `add-login-endpoint` | `user-auth` | 能力要能长期拥有相关需求 |
| `t2-2-refactor` | `ai-customer/intent-selection` | 编排编号会过期 |

规则：**kebab-case**，按"持久行为"命名，避免 `misc`、`utils` 这类大杂烩。路径段层级跟随项目既有组织。

### 5.4 什么时候不需要 spec

`.openspec.yaml` 里写：

```yaml
skip_specs: true
```

只用于**没有行为变化**的变更（纯重构、工具链、文档）。有行为变化就必须写 spec——不要为了过校验硬造需求。

---

## 六、常见坑

| 坑 | 真相 |
|---|---|
| 以为 `openspec list` 会列 specs | 不带 `--specs` 时列的是 **changes** |
| `--deltas-only` 没效果 | 它要求同时带 `--json` |
| `openspec show <change>` 只看到 proposal | 默认一次一份；要全量用 `--json` |
| 直接写 `tasks.md` | 必须先有 `specs` 和 `design`，否则语义断裂 |
| 改了想法不知道怎么办 | 用 `/openspec-update-change` 修订并保持各产物一致 |
| 归档后 specs 没出现 | 必须先 `archive`，delta 才合并进主规格 |
| 任务没勾完就归档 | `openspec validate --archived` 会拦 |
| 能力名和变更名混用 | 变更名只活到归档，能力名长期存在 |
| 以为 `design.md` 必填 | schema 里是条件性产物，纯小改动可省 |

---

## 七、用 OpenSpec 快速理解一个陌生项目

**四步口诀**：

| 顺序 | 命令 | 回答什么 |
|---|---|---|
| 1 | `openspec list --specs` | 系统有哪些能力？（可能是空——那就说明项目还没建基线） |
| 2 | `openspec list` | 正在改什么？做到哪了？ |
| 3 | `openspec show <change>` | 为什么改、改什么、影响哪 |
| 4 | `openspec show <change> --json --deltas-only` | 系统承诺变成什么样（验收标准） |

**为什么比读代码快**：规格写的是"这个系统承诺做什么"，代码写的是"现在恰好怎么做的"。前者是意图，后者是实现。先有意图再读实现，理解成本低一个量级。

**更快的路径**：`openspec config profile` 打开 `custom`，用 `/openspec-onboard` 让 AI 带着走。

---

## 八、本项目落地约定

| 项 | 约定 |
|---|---|
| 范围 | 增量采用：老文档 `docs/AI-joymini/` 保持档案，不迁移 |
| 新需求 | 一律先写 `openspec/changes/<name>/` 提案，再动代码 |
| 引用旧文档 | 写链接不复制，防止漂移 |
| 旧文档被推翻 | 在提案里标记 superseded |
| 语言 | `zh-CN`，`SHALL/MUST` 保留英文 |
| 校验 | 合入前跑 `openspec validate <change> --strict` |

---

## 参考

- 官网：https://openspec.dev
- 仓库：https://github.com/Fission-AI/OpenSpec
- 项目内已生成的 skills：`.claude/skills/openspec-*`（本体在 `.agents/skills/`）
