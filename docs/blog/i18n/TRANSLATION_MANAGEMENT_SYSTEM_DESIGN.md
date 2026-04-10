# 翻译管理系统设计文档 v1.0

**最后更新**: 2026-04-10  
**状态**: 规划完成  
**优先级**: 中等 (Blog 模块稳定后实施)

---

## 🎯 系统定位

这是一个独立的通用翻译管理系统，服务于整个平台所有模块，不耦合于任何业务逻辑。

✅ 设计目标：

- 100% 兼容现有 i18n 生态
- 零侵入，现有代码不需要任何修改
- 完整的企业级工作流
- 支持从开发到运营到发布的完整链路

---

## 🗄️ 数据库设计

### 1. `translation_keys` 翻译主键表

```prisma
model TranslationKey {
  id          String   @id @default(uuid())
  key         String   @unique
  namespace   String   @default("common")
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  values      TranslationValue[]

  @@index([namespace])
  @@index([key])
}
```

### 2. `translation_values` 翻译内容表

```prisma
model TranslationValue {
  id         String   @id @default(uuid())
  keyId      String
  locale     String
  value      String
  status     String   @default("draft") // draft / translated / approved
  authorId   String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  key        TranslationKey @relation(fields: [keyId], references: [id], onDelete: Cascade)

  @@unique([keyId, locale])
  @@index([status])
}
```

### 3. `translation_releases` 发布版本表

```prisma
model TranslationRelease {
  id         String   @id @default(uuid())
  version    String   @unique // v1.0.0
  snapshot   Json     // 完整的翻译快照，永不修改
  authorId   String?
  createdAt  DateTime @default(now())
}
```

✅ 核心设计原则：

> 所有的编辑都是在草稿上进行的。只有在明确点击"发布"的时候，才会生成一个不可变的快照，然后这个快照才会被构建系统使用。

---

## 🎛️ API 接口设计

| 方法   | 路径                                   | 说明                      | 权限     |
| ------ | -------------------------------------- | ------------------------- | -------- |
| `GET`  | `/api/v1/translations/keys`            | 分页列出所有翻译Key       | 翻译人员 |
| `POST` | `/api/v1/translations/keys`            | 新增翻译Key               | 开发/CI  |
| `GET`  | `/api/v1/translations/values/:keyId`   | 获取指定Key的所有语言翻译 | 翻译人员 |
| `PUT`  | `/api/v1/translations/values/:id`      | 更新翻译内容              | 翻译人员 |
| `POST` | `/api/v1/translations/translate-all`   | AI一键翻译所有未翻译内容  | 翻译人员 |
| `POST` | `/api/v1/translations/release`         | 发布新版本，生成快照      | 管理员   |
| `GET`  | `/api/v1/translations/releases`        | 列出所有历史版本          | 管理员   |
| `GET`  | `/api/v1/translations/releases/latest` | 获取最新已发布版本        | 公开     |
| `GET`  | `/api/v1/translations/export/:locale`  | 导出指定语言为标准JSON    | 公开     |

✅ 导出JSON格式和 `next-intl`, `i18next` 100% 兼容。

---

## 🖥️ 后台界面设计

### 主界面布局

```
┌───────────────────────────────────────────────────────────────────┐
│ 🔍 搜索: [____________]  📂 命名空间: [▼]  🌍 语言: [▼]  🚥 状态: [▼] │
├───────────────────────────────────────────────────────────────────┤
│ Key                     中文             英文             状态    │
├───────────────────────────────────────────────────────────────────┤
│ blog.article.views      查看次数         Views            ✅ 已审核 │
│ blog.article.date       发布日期         Published on     ⏳ 已翻译 │
│ common.save             保存             Save             ✅ 已审核 │
│ common.cancel           取消             Cancel           📝 草稿   │
│ ...                                                                   │
├───────────────────────────────────────────────────────────────────┤
│ 🤖 一键翻译所有未翻译 │ 📦 导出JSON │ 🚀 发布新版本 │ ↩️ 回滚到历史版本 │
└───────────────────────────────────────────────────────────────────┘
```

### 操作流程

1.  开发人员在代码里写 `t('blog.article.views')`
2.  CI 自动扫描源代码，提取所有新Key，自动插入数据库
3.  系统自动给翻译团队发送通知
4.  翻译人员打开后台，点击"一键翻译"
5.  人工检查修改，标记为已审核
6.  所有翻译完成后，管理员点击"发布"
7.  系统生成不可变版本快照
8.  下次构建自动拉取最新发布版本

---

## 🔄 CI/CD 集成

### 构建流程

```bash
# 构建时自动执行
npm run build

# 构建前自动拉取最新已发布翻译
npx i18n pull --latest

# 生成优化后的JSON文件到 public/locales
```

✅ 开发人员、翻译人员、运营人员都不需要提交翻译文件到git仓库。

---

## 🚀 实施路线图

### 阶段一：核心功能 (1 天)

- [ ] 数据库表设计和迁移
- [ ] 基础CRUD API
- [ ] 翻译列表界面
- [ ] 编辑功能

### 阶段二：工作流 (2 天)

- [ ] 状态流管理
- [ ] AI 一键翻译集成
- [ ] 版本发布功能
- [ ] 历史版本和回滚

### 阶段三：自动化 (1 天)

- [ ] 源代码Key自动扫描
- [ ] CLI工具
- [ ] CI 集成
- [ ] 导出/导入JSON功能

---

## ✅ 兼容性保证

### 完全向后兼容

- ✅ 现有 `t()` 函数调用不需要任何修改
- ✅ 现有 JSON 翻译文件可以一键导入
- ✅ 可以随时切换回原来的文件模式
- ✅ 支持增量迁移，可以只把一部分Key放到系统里管理

---

这是一个完整独立的系统，和我们现在正在做的Blog模块多语言完全解耦。我们可以先把Blog模块上线跑稳定，然后再逐步实现这个翻译管理系统。
