# 博客模块安全改造计划

> 🚨 紧急安全问题：目前所有博客管理后台接口完全没有JWT校验和权限控制，存在严重的安全漏洞

## 📋 现状分析

### ❌ 目前存在的安全问题

1.  **管理接口完全开放** - 任何人都可以直接调用文章的增删改接口
2.  **缺少JWT认证** - 没有校验登录状态
3.  **缺少权限校验** - 没有权限系统拦截
4.  **缺少Swagger认证标识** - API文档无法测试
5.  **响应没有做DTO过滤** - 直接返回数据库字段

### 项目标准安全规范

所有Admin接口统一使用以下安全架构：

```typescript
@ApiTags("Admin XXX")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("admin/xxx")
export class XxxController {
  @Get("list")
  @RequirePermission(MODULE, ACTION)
  async list() {
    // ...
  }
}
```

## 🎯 改造目标

### 第一阶段：基础安全加固 (优先级: 最高)

| 控制器                            | 状态       | 完成时间   |
| --------------------------------- | ---------- | ---------- |
| `article/article.controller.ts`   | **已完成** | 2026-04-07 |
| `category/category.controller.ts` | **已完成** | 2026-04-07 |
| `tag/tag.controller.ts`           | **已完成** | 2026-04-07 |
| `comment/comment.controller.ts`   | **已完成** | 2026-04-07 |

### 第二阶段：公开接口安全加固 (优先级: 高)

| 安全措施        | 状态      |
| --------------- | --------- |
| 评论接口限流    | 已完成    |
| 点赞接口限流    | 已完成    |
| 评论XSS过滤     | ❌ 待实现 |
| 点赞指纹去重    | ❌ 待实现 |
| ReCaptcha验证码 | ❌ 待实现 |

### 第三阶段：权限细粒度控制 (优先级: 中)

| 权限点   | 模块   | 操作               |
| -------- | ------ | ------------------ |
| 查看文章 | `blog` | `view`             |
| 创建文章 | `blog` | `create`           |
| 编辑文章 | `blog` | `update`           |
| 删除文章 | `blog` | `delete`           |
| 管理分类 | `blog` | `category_manage`  |
| 管理标签 | `blog` | `tag_manage`       |
| 审核评论 | `blog` | `comment_moderate` |

## 🔧 改造标准

### 每一个控制器必须包含：

1.  `@ApiBearerAuth()` - Swagger认证支持
2.  `@UseGuards(JwtAuthGuard, PermissionsGuard)` - 强制JWT+权限校验
3.  每个方法添加 `@RequirePermission()` 注解
4.  所有请求参数使用DTO校验
5.  所有响应使用 `plainToInstance()` 转换
6.  响应字段过滤，不返回敏感字段

## 📅 实施步骤

### Step 1: 改造 Article 控制器

- 添加类级别安全注解
- 为每个接口添加权限注解
- 添加DTO响应转换

### Step 2: 改造 Category 控制器

- 同上标准改造
- 添加分类管理权限

### Step 3: 改造 Tag 控制器

- 同上标准改造
- 添加标签管理权限

### Step 4: 改造 Comment 控制器

- 同上标准改造
- 添加评论审核权限

### Step 5: 公开接口增强

- 添加XSS内容过滤
- 实现点赞指纹去重
- 添加ReCaptcha验证码支持

## ⚠️ 风险说明

**改造影响范围：**

- 管理后台前端需要在请求头中携带正确的Bearer Token
- Swagger文档需要重新登录获取Token
- 需要在权限系统中添加博客模块的权限配置

**回滚方案：**

- 可以随时回滚单个控制器
- 不会影响公开访问接口
- 不会影响前端博客页面功能

## 验收标准

改造完成后验证：

1.  ❌ 未登录用户调用返回 401 Unauthorized
2.  ❌ 无权限用户调用返回 403 Forbidden
3.  有权限用户可以正常操作
4.  Swagger文档可以正常授权测试
5.  响应中不包含敏感字段

---

## 改造进度更新

**当前完成度: 100% (4/4 控制器)**

所有控制器安全加固已完成:

- Article 文章管理接口
- Category 分类管理接口
- Tag 标签管理接口
- Comment 评论管理接口

🎉 第一阶段基础安全加固全部完成！

---

**文档版本**: 1.1
**最后更新**: 2026-04-07
**负责人**: AI Assistant
