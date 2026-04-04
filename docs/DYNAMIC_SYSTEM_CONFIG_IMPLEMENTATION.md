# 完全动态化系统配置实施文档

## 概述

本文档描述将现有系统配置功能从"只能更新已存在配置"升级为"完全动态化配置管理"的实施方案。管理员可以创建、更新、删除任意key-value配置，客户端可以获取这些配置。

## 当前状态分析

### 已存在的功能

1. **数据库表**：`SystemConfig` 表已存在，支持key-value存储
2. **管理端接口**：
   - `GET /v1/admin/system-config` - 获取所有配置
   - `PATCH /v1/admin/system-config/:key` - 更新配置（仅限已存在的key）
3. **前端管理界面**：`/settings` 页面已实现配置显示和内联编辑
4. **测试**：包含单元测试和E2E测试

### 缺失的功能

1. **创建配置**：无法创建新的配置项
2. **删除配置**：无法删除配置项
3. **客户端接口**：没有客户端获取配置的接口
4. **完全动态管理**：前端缺少创建和删除功能的UI

## 实施目标

### 功能需求

1. 管理员可以创建新的系统配置（任意key-value）
2. 管理员可以删除现有的系统配置
3. 客户端可以获取所有系统配置（无需认证或可选认证）
4. 前端管理界面支持完整的CRUD操作

### 非功能需求

1. 保持向后兼容性
2. 保持现有测试的完整性
3. 提供良好的用户体验
4. 支持配置项的实时生效

## 技术方案

### 后端架构增强

#### 新增DTO

**1. 创建配置DTO**

```typescript
// apps/api/src/admin/system-config/dto/create-system-config.dto.ts
import { IsString, Length } from "class-validator";

export class CreateSystemConfigDto {
  @IsString()
  @Length(1, 100)
  key!: string;

  @IsString()
  @Length(1, 255)
  value!: string;
}
```

#### 服务层增强

**SystemConfigService 增强**

```typescript
// apps/api/src/admin/system-config/system-config.service.ts
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "@api/common/prisma/prisma.service";
import { UpdateSystemConfigDto } from "./dto/update-system-config.dto";
import { CreateSystemConfigDto } from "./dto/create-system-config.dto";

@Injectable()
export class SystemConfigService {
  constructor(private readonly prisma: PrismaService) {}

  // 现有方法保持不变
  async getAll() {
    const configs = await this.prisma.systemConfig.findMany({
      orderBy: { key: "asc" },
    });
    return { list: configs };
  }

  async update(key: string, dto: UpdateSystemConfigDto) {
    const existing = await this.prisma.systemConfig.findUnique({
      where: { key },
    });
    if (!existing) throw new NotFoundException(`Config key "${key}" not found`);

    return this.prisma.systemConfig.update({
      where: { key },
      data: { value: dto.value },
    });
  }

  // 新增：创建配置
  async create(dto: CreateSystemConfigDto) {
    // 检查是否已存在
    const existing = await this.prisma.systemConfig.findUnique({
      where: { key: dto.key },
    });

    if (existing) {
      throw new ConflictException(`Config key "${dto.key}" already exists`);
    }

    return this.prisma.systemConfig.create({
      data: {
        key: dto.key,
        value: dto.value,
      },
    });
  }

  // 新增：删除配置
  async delete(key: string) {
    const existing = await this.prisma.systemConfig.findUnique({
      where: { key },
    });

    if (!existing) {
      throw new NotFoundException(`Config key "${key}" not found`);
    }

    return this.prisma.systemConfig.delete({
      where: { key },
    });
  }

  // 新增：客户端获取配置（可选：可以添加白名单过滤）
  async getAllForClient() {
    const configs = await this.prisma.systemConfig.findMany({
      orderBy: { key: "asc" },
    });

    return { list: configs };
  }
}
```

#### 控制器层增强

**SystemConfigController 增强**

```typescript
// apps/api/src/admin/system-config/system-config.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { SystemConfigService } from "./system-config.service";
import { UpdateSystemConfigDto } from "./dto/update-system-config.dto";
import { CreateSystemConfigDto } from "./dto/create-system-config.dto";
import { AdminJwtAuthGuard } from "../auth/admin-jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { Role } from "@lucky/shared";

@Controller("admin/system-config")
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class SystemConfigController {
  constructor(private readonly service: SystemConfigService) {}

  /** GET /v1/admin/system-config — 全部配置项 */
  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  getAll() {
    return this.service.getAll();
  }

  /** POST /v1/admin/system-config — 创建新配置 */
  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  create(@Body() dto: CreateSystemConfigDto) {
    return this.service.create(dto);
  }

  /** PATCH /v1/admin/system-config/:key — 更新单项 */
  @Patch(":key")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  update(@Param("key") key: string, @Body() dto: UpdateSystemConfigDto) {
    return this.service.update(key, dto);
  }

  /** DELETE /v1/admin/system-config/:key — 删除配置 */
  @Delete(":key")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  delete(@Param("key") key: string) {
    return this.service.delete(key);
  }
}
```

#### 新增客户端系统配置模块

**客户端系统配置控制器**

```typescript
// apps/api/src/client/system-config/system-config.controller.ts
import { Controller, Get, UseGuards } from "@nestjs/common";
import { ClientSystemConfigService } from "./system-config.service";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt-auth.guard";

@Controller("client/system-config")
@UseGuards(OptionalJwtAuthGuard) // 可选认证
export class ClientSystemConfigController {
  constructor(private readonly service: ClientSystemConfigService) {}

  /** GET /v1/client/system-config — 获取所有客户端配置 */
  @Get()
  getAll() {
    return this.service.getAll();
  }
}
```

**客户端系统配置服务**

```typescript
// apps/api/src/client/system-config/system-config.service.ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "@api/common/prisma/prisma.service";

@Injectable()
export class ClientSystemConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll() {
    const configs = await this.prisma.systemConfig.findMany({
      orderBy: { key: "asc" },
    });

    return { list: configs };
  }
}
```

**客户端系统配置模块**

```typescript
// apps/api/src/client/system-config/system-config.module.ts
import { Module } from "@nestjs/common";
import { PrismaModule } from "@api/common/prisma/prisma.module";
import { ClientSystemConfigController } from "./system-config.controller";
import { ClientSystemConfigService } from "./system-config.service";

@Module({
  imports: [PrismaModule],
  controllers: [ClientSystemConfigController],
  providers: [ClientSystemConfigService],
})
export class ClientSystemConfigModule {}
```

**注册到客户端模块**

```typescript
// apps/api/src/client/client.module.ts
import { Module } from "@nestjs/common";
// ... 其他导入
import { ClientSystemConfigModule } from "./system-config/system-config.module";

@Module({
  imports: [
    // ... 其他模块
    ClientSystemConfigModule, // 新增
  ],
  providers: [],
  controllers: [HealthController],
})
export class ClientModule {}
```

### 前端架构增强

#### API客户端增强

**管理端API增强**

```typescript
// apps/admin-next/src/api/index.ts
// 在 systemConfigApi 对象中添加：
export const systemConfigApi = {
  getAll: () =>
    http.get<{ list: import("@/type/types").SystemConfigItem[] }>(
      "/v1/admin/system-config",
    ),

  create: (data: { key: string; value: string }) =>
    http.post<import("@/type/types").SystemConfigItem>(
      "/v1/admin/system-config",
      data,
    ),

  update: (key: string, value: string) =>
    http.patch<import("@/type/types").SystemConfigItem>(
      `/v1/admin/system-config/${key}`,
      { value },
    ),

  delete: (key: string) =>
    http.delete<{ success: boolean }>(`/v1/admin/system-config/${key}`),
};
```

**新增客户端API**

```typescript
// 在同一个文件中添加：
export const clientSystemConfigApi = {
  getAll: () =>
    http.get<{ list: { key: string; value: string }[] }>(
      "/v1/client/system-config",
    ),
};
```

#### 前端组件增强

**增强SettingsClient组件**

```tsx
// apps/admin-next/src/components/settings/SettingsClient.tsx
// 添加创建表单和删除功能
import React, { useState } from 'react';
import { useRequest } from 'ahooks';
import { Settings, RefreshCw, Edit2, X, Check, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { systemConfigApi } from '@/api';
import type { SystemConfigItem } from '@/type/types';

// ... 现有代码保持不变

// 新增：创建配置表单组件
function CreateConfigForm({ onCreated }: { onCreated: () => void }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const handleSubmit = async () => {
    if (!key.trim() || !value.trim()) return;

    setCreating(true);
    try {
      await systemConfigApi.create({ key: key.trim(), value: value.trim() });
      onCreated();
      setKey('');
      setValue('');
      setShowForm(false);
    } catch (error) {
      console.error('Failed to create config:', error);
    } finally {
      setCreating(false);
    }
  };

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-500 rounded-lg hover:bg-teal-600 transition-colors"
      >
        <Plus size={16} />
        创建新配置
      </button>
    );
  }

  return (
    <div className="p-4 mb-4 border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          创建新配置
        </h3>
        <button
          onClick={() => setShowForm(false)}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            配置键 (Key)
          </label>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="例如: max_login_attempts"
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-white/10 rounded-lg bg-white dark:bg-gray-800"
            autoFocus
          />
          <p className="mt-1 text-xs text-gray-500">
            唯一标识符，建议使用小写字母和下划线
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            配置值 (Value)
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="例如: 5"
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-white/10 rounded-lg bg-white dark:bg-gray-800"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={creating || !key.trim() || !value.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-teal-500 rounded-lg hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? '创建中...' : '创建配置'}
          </button>
          <button
            onClick={() => setShowForm(false)}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-white/10 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// 修改ConfigRow组件，添加删除功能
function ConfigRow({
  item,
  onSave,
  onDelete,
}: {
  item: SystemConfigItem;
  onSave: (key: string, value: string) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.value);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const meta = CONFIG_META[item.key];

  const handleSave = async () => {
    if (draft === item.value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(item.key, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`确定要删除配置 "${item.key}" 吗？此操作不可撤销。`)) {
      return;
    }

    setDeleting(true);
    try {
      await onDelete(item.key);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-gray-100 dark:border-white/5 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {meta?.label ?? item.key}
          </p>
          <code className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 font-mono">
            {item.key}
          </code>
        </div>
        {meta?.description && (
          <p className="text-xs text-gray-400 mt-0.5">{meta.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {editing ? (
          <>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave();
                if (e.key === 'Escape') {
                  setDraft(item.value);
                  setEditing(false);
                }
              }}
              className="w-48 px-3 py-1.5 text-sm rounded-xl border border-teal-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
            />
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="p-1.5 rounded-lg bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Check size={13} />
              )}
            </button>
            <button
              onClick={() => {
                setDraft(item.value);
                setEditing(false);
              }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
            >
              <X size={13} />
            </button>
          </>
        ) : (
          <>
            <span className="text-sm font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-white/5 px-3 py-1.5 rounded-xl min-w-24 text-right">
              {item.value}
            </span>
            <button
              onClick={() => setEditing(true)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors
```
