---
title: 'S3 浏览器直传 CORS 踩坑实录：从 "Network Error" 到双云上传的完整调试过程'
slug: 's3-browser-upload-cors-troubleshooting'
tags:
  - AWS
  - S3
  - CORS
  - DevOps
  - Debugging
  - Cloudflare
  - R2
description: 基于 JoyMini 双云存储架构的实战经验，完整记录从 "Featured image upload failed: network error" 到定位 S3 桶缺少 CORS 配置的调试过程，包括浏览器预检机制分析、CLI 即时修复、CDK 持久化配置以及 R2 与 S3 在 CORS 行为上的关键差异。
---

# S3 浏览器直传 CORS 踩坑实录：从 "Network Error" 到双云上传的完整调试过程

> 当存储从 Cloudflare R2 切换到 AWS S3 后，浏览器上传突然报 "network error"。这不是网络问题，而是 CORS（跨域资源共享）配置缺失导致的经典踩坑。本文完整记录了从问题出现、定位根因、到修复的全过程，帮助你避免同样的坑。

---

## 目录

- [1. 背景：双云存储与浏览器直传](#1-背景双云存储与浏览器直传)
- [2. 问题现象](#2-问题现象)
- [3. 上传流程拆解](#3-上传流程拆解)
  - [3.1 三步上传设计](#31-三步上传设计)
  - [3.2 为什么不用后端代理上传](#32-为什么不用后端代理上传)
- [4. 原因分析](#4-原因分析)
  - [4.1 浏览器 CORS 预检机制](#41-浏览器-cors-预检机制)
  - [4.2 为什么 R2 可以而 S3 不行](#42-为什么-r2-可以而-s3-不行)
  - [4.3 根因确认](#43-根因确认)
- [5. 修复过程](#5-修复过程)
  - [5.1 CLI 即时修复](#51-cli-即时修复)
  - [5.2 CDK 持久化配置](#52-cdk-持久化配置)
  - [5.3 验证](#53-验证)
- [6. 关键教训](#6-关键教训)
- [7. 相关代码与文件](#7-相关代码与文件)

---

## 1. 背景：双云存储与浏览器直传

JoyMini 的图片存储采用双云架构：

| 云 | 存储桶 | CDN | 用途 |
|---|--------|-----|------|
| **AWS S3** | `your-bucket-name` | `images.joyminis.com` (CloudFront) | 主存储 |
| **Cloudflare R2** | `your-bucket-name` | `img.joyminis.com` (Cloudflare) | 灾备 |

存储模式通过环境变量 `STORAGE_MODE` 控制：
- `r2`（默认）：上传到 R2，通过 Cloudflare CDN 分发
- `s3`：上传到 S3，通过 CloudFront 分发
- `dual`：上传到 S3，同时同步到 R2；通过 CloudFront 分发

后端代码见 [`apps/api/src/common/upload/upload.service.ts`](../../../apps/api/src/common/upload/upload.service.ts) 的 `getActiveClient()` 和 `getActiveDomain()` 方法，根据 `STORAGE_MODE` 动态选择目标存储和 CDN 域名。

## 2. 问题现象

在管理后台（`blog-admin.joyminis.com`）编辑文章时，选择 featured image 后浏览器报错：

```
Featured image upload failed: Error: Upload failed: network error
```

同时 DevTools Console 显示：

```
POST https://your-bucket-name.s3.us-east-1.amazonaws.com/... net::ERR_FAILED
```

观察 Network 面板，发现有一个 `OPTIONS` 请求返回了状态码 `403`，紧随其后的 `PUT` 请求直接被浏览器拦截，根本没有发出。

## 3. 上传流程拆解

### 3.1 三步上传设计

管理后台的 featured image 上传并非传统的 multipart/form-data POST，而是采用了 **presigned URL 直传** 模式，分为三步：

```
┌──────────────────────────────────────────────────────────────┐
│  blog-admin.joyminis.com (浏览器)                             │
│                                                              │
│  步骤 1: POST /v1/admin/upload/presigned-url                 │
│          ──────────────→ NestJS API                          │
│          ← { url, key, cdnUrl }  获取 S3 预签名 URL          │
│                                                              │
│  步骤 2: PUT 文件直接到 S3                                    │
│          ──────────────→ your-bucket-name.s3.amazonaws.com │
│          ↑  ！！CORS 预检失败，请求被浏览器拦截！！             │
│                                                              │
│  步骤 3: POST /v1/admin/upload/confirm   (永远不会执行)       │
│          ──────────────→ NestJS API                          │
└──────────────────────────────────────────────────────────────┘
```

关键代码在 [`apps/admin-blog/src/api/http.ts`](../../../apps/admin-blog/src/api/http.ts) 的 `uploadDirect()` 方法：

```typescript
public async uploadDirect<T = { url: string; key: string }>(
  presignedUrlEndpoint: string,
  confirmEndpoint: string,
  file: File,
  onProgress?: (percent: number) => void,
  extraFields?: Record<string, any>,
): Promise<T> {
  // 步骤 1：获取 presigned URL
  const { url, key, cdnUrl } = await this.post(presignedUrlEndpoint, {
    fileName: file.name,
    fileType: file.type,
    ...extraFields,
  });

  // 步骤 2：浏览器直传到 S3（使用原生 XHR 避免 axios 拦截器添加额外签名头）
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => { /* 进度回调 */ };
    xhr.onload = () => resolve();
    xhr.onerror = () => reject(new Error('Upload failed: network error'));  // ← 这里
    xhr.send(file);
  });

  // 步骤 3：确认上传
  return this.post(confirmEndpoint, { key, cdnUrl });
}
```

注意第 2 步使用了原生 `XMLHttpRequest` 而非 axios，目的是避免 axios 拦截器自动添加鉴权头，因为 presigned URL 的签名校验非常严格——任何额外的请求头都会导致签名失效。

### 3.2 为什么不用后端代理上传

传统的文件上传方式是浏览器将文件 POST 到后端，后端再转发到 S3：

```
浏览器 ──POST──→ NestJS ──PUT──→ S3
```

但这种方式有两个问题：
1. **服务器带宽浪费**：大文件（20MB+）经过后端服务器，占用 ECS Fargate 的带宽和内存
2. **请求超时**：NestJS 默认请求体大小限制 + nginx `proxy_read_timeout` 限制

Presigned URL 直传将上传流量直接从浏览器导向 S3，后端只做签名和确认，显著降低服务器负载。这也是 AWS 推荐的最佳实践。

## 4. 原因分析

### 4.1 浏览器 CORS 预检机制

前面提到步骤 2 的 PUT 请求是一个跨域请求：

| 来源 | 目标 |
|------|------|
| `blog-admin.joyminis.com` | `your-bucket-name.s3.us-east-1.amazonaws.com` |

根据 MDN 文档：[CORS（Cross-Origin Resource Sharing）](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)：

PUT 请求属于"非简单请求"（non-simple request），浏览器会在正式 PUT 之前先发送一个 **OPTIONS 预检请求**（preflight request），询问服务器是否允许跨域：

```
OPTIONS /uploads/blog/xxx.png
Origin: https://blog-admin.joyminis.com
Access-Control-Request-Method: PUT
Access-Control-Request-Headers: content-type
```

服务器需要在响应头中明确允许该来源和方法：

```
Access-Control-Allow-Origin: https://blog-admin.joyminis.com
Access-Control-Allow-Methods: PUT
Access-Control-Allow-Headers: Content-Type
```

如果服务器没有返回这些头（或返回不匹配），浏览器就会拦截实际的 PUT 请求，并在 console 报错。但问题的关键是——**这个错误是浏览器层面的拦截，不会产生 HTTP 响应**，所以 `xhr.onerror` 捕获到的只是一个笼统的 "network error"。

### 4.2 为什么 R2 可以而 S3 不行

这是一个容易忽略的关键差异：

**Cloudflare R2**：默认配置了宽松的 CORS 规则，允许任意来源的 PUT 请求。即使不显式配置 CORS，R2 也会在 OPTIONS 预检中返回允许的响应头。

**AWS S3**：**默认拒绝所有跨域请求**。S3 桶创建时没有 CORS 配置，除非显式通过 `put-bucket-cors` 或 CloudFormation/CDK 的 `cors` 属性配置，否则所有跨域请求都会被拒绝。

这也就是为什么之前使用 `STORAGE_MODE=r2` 时从未遇到这个问题——R2 默默地处理了 CORS，而切到 `dual` 或 `s3` 模式后，S3 的严格策略就暴露出来了。

### 4.3 根因确认

通过 AWS CLI 验证：

```bash
$ aws s3api get-bucket-cors --bucket your-bucket-name

An error occurred (NoSuchCORSConfiguration) when calling the GetBucketCors operation:
```

确实没有任何 CORS 配置。同时检查 CDK 基础设施代码 [`infra/lib/infra-stack.ts`](../../../infra/lib/infra-stack.ts)，发现 Bucket 定义中也没有 `cors` 属性：

```typescript
const bucket = new s3.Bucket(this, 'JoyMiniImagesBucket', {
  bucketName: 'your-bucket-name',
  encryption: BucketEncryption.S3_MANAGED,
  versioned: false,
  // ⚠️ 没有 cors 配置
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  lifecycleRules: [
    // ... 生命周期规则
  ],
});
```

> **注**：`BlockPublicAccess.BLOCK_ALL` 与 CORS 配置不冲突。CORS 只控制浏览器是否允许跨域请求，presigned URL 仍然需要有效的 AWS 签名才能上传文件。CORS 配置不会开放公共上传。

## 5. 修复过程

### 5.1 CLI 即时修复

首先通过 AWS CLI 直接为 S3 桶添加 CORS 配置，立即生效，无需部署：

```bash
aws s3api put-bucket-cors --bucket your-bucket-name --cors-configuration '{
  "CORSRules": [
    {
      "AllowedOrigins": [
        "https://admin.joyminis.com",
        "https://blog-admin.joyminis.com",
        "https://blog.joyminis.com",
        "http://localhost:3000",
        "https://dev.joyminis.com"
      ],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["Content-Type"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}'
```

CORS 配置参数说明：

| 参数 | 值 | 说明 |
|------|-----|------|
| `AllowedOrigins` | admin/blog 所有域名 | 只允许这些域名发起跨域上传 |
| `AllowedMethods` | `PUT` | 只需要 PUT 方法上传文件 |
| `AllowedHeaders` | `Content-Type` | 允许浏览器发送 Content-Type 头（presigned URL 签名包含此头） |
| `ExposeHeaders` | `ETag` | 暴露 S3 返回的 ETag（文件校验和），前端可用于验证 |
| `MaxAgeSeconds` | `3600` | 预检响应缓存 1 小时，减少重复 OPTIONS 请求 |

### 5.2 CDK 持久化配置

仅通过 CLI 修改不够——下次 `cdk deploy` 会覆盖手动配置。需要在 CDK 代码中添加 `cors` 属性，确保基础设施即代码（IaC）的一致性：

[`infra/lib/infra-stack.ts`](../../../infra/lib/infra-stack.ts) 和 [`infra/lib/constructs/s3-r2-sync.ts`](../../../infra/lib/constructs/s3-r2-sync.ts) 中的 bucket 定义都添加了：

```typescript
cors: [
  {
    allowedOrigins: [
      "https://admin.joyminis.com",
      "https://blog-admin.joyminis.com",
      "https://blog.joyminis.com",
      "https://dev.joyminis.com",
    ],
    allowedMethods: [s3.HttpMethods.PUT],
    allowedHeaders: ["Content-Type"],
    exposedHeaders: ["ETag"],
    maxAge: 3600,
  },
],
```

> **为什么改了两个文件？** 因为 `infra-stack.ts` 定义了主 S3 桶，而 `s3-r2-sync.ts` 是 S3→R2 同步 Construct，内部也创建了一个对同一桶的引用。两个位置都需要 CORS 配置以确保一致性。

### 5.3 验证

修复后测试上传：

```json
{
  "code": 10000,
  "message": "success",
  "data": {
    "url": "https://your-bucket-name.s3.us-east-1.amazonaws.com/...",
    "key": "uploads/blog/xxx/xxx.png",
    "cdnUrl": "https://images.joyminis.com/..."
  }
}
```

- `url` 指向 S3 ✅（不再是 R2）
- `cdnUrl` 指向 `images.joyminis.com`（CloudFront）✅
- 浏览器 PUT 请求不再被拦截 ✅
- 完整三步上传流程成功 ✅

同时验证了 `like-status` 接口恢复正常，之前存在的 404 问题也随之解决。

## 6. 关键教训

### 6.1 S3 需要显式配置 CORS

这个教训看似简单，但在实际项目中很容易被忽略：

- **R2 默认允许跨域** → 开发测试都没问题
- **切换到 S3 后** → CORS 缺失 → "network error"

S3 的默认安全策略比 R2 严格，这是好事——但它要求开发者显式配置跨域规则，否则浏览器直传就会失败。

### 6.2 两种 CORS 不要混淆

项目中存在两种 CORS 配置，它们控制不同层面的访问：

| 配置类型 | 位置 | 控制什么 |
|----------|------|---------|
| **NestJS CORS** | `main.ts` 中的 `CORS_ORIGIN` 环境变量 | 哪些域名可以调用 NestJS API |
| **S3 Bucket CORS** | S3 桶的 `cors` 配置 | 哪些域名可以直传文件到 S3 |

两者都需要正确配置，缺一不可。

### 6.3 Presigned URL 直传的注意事项

1. **使用原生 XHR**：避免 axios 拦截器自动添加 `Authorization`、`X-Requested-With` 等头，这些头会导致 S3 签名校验失败
2. **Content-Type 必须匹配**：presigned URL 签名时指定的 Content-Type 必须与 PUT 请求的 Content-Type 一致
3. **CORS 先于签名**：即使 presigned URL 有效，浏览器 CORS 策略仍会拦截请求

### 6.4 CLI 修复与 CDK 修复的关系

对于生产环境配置变更：

1. **CLI 即时修复**：快速止血，立即恢复服务
2. **CDK 持久化**：确保下次 IaC 部署不会回滚修复

两者是互补关系，不是替代关系。只做 CLI 不改 CDK，下次 `cdk deploy` 会覆盖手动修改；只改 CDK 不做 CLI，则等待部署期间服务不可用。

### 6.5 新增域名时的维护

将来如果增加新的前端域名（如新的管理面板或博客子站），需要同步更新 S3 桶的 CORS 配置。建议将 allowedOrigins 列表维护在 CDK 变量中，便于统一管理。

## 7. 相关代码与文件

| 文件 | 用途 |
|------|------|
| [`apps/admin-blog/src/api/http.ts`](../../../apps/admin-blog/src/api/http.ts) | `uploadDirect()` 三步上传实现 |
| [`apps/admin-blog/src/api/index.ts`](../../../apps/admin-blog/src/api/index.ts) | `uploadMediaDirect` API 封装 |
| [`apps/admin-blog/src/views/blog/BlogArticleModal.tsx`](../../../apps/admin-blog/src/views/blog/BlogArticleModal.tsx) | featured image 上传 UI 触发点 |
| [`apps/api/src/common/upload/upload.service.ts`](../../../apps/api/src/common/upload/upload.service.ts) | presigned URL 生成 + 双云存储路由 |
| [`apps/api/src/common/upload/upload.controller.ts`](../../../apps/api/src/common/upload/upload.controller.ts) | presigned-url + confirm 接口 |
| [`infra/lib/infra-stack.ts`](../../../infra/lib/infra-stack.ts) | S3 桶 CDK 定义（含 CORS 配置） |
| [`infra/lib/constructs/s3-r2-sync.ts`](../../../infra/lib/constructs/s3-r2-sync.ts) | S3→R2 同步 Construct（含 CORS 配置） |
| [`plans/s3-cors-config-summary.md`](../../../plans/s3-cors-config-summary.md) | 修复过程详细记录 |

---

*本文是 JoyMini 双云架构系列文章之一，其他文章见 [`docs/blog/articles/devops/`](../../../docs/blog/articles/devops/)。*
