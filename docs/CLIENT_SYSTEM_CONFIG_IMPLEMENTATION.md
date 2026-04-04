# 客户端系统配置接口实现方案

## 概述

本文档描述客户端系统配置接口的实现方案，该接口允许客户端应用获取平台公开配置信息（如汇率、平台名称、提现配置等），无需管理员权限。

## 当前状态分析

### 现有系统

1. **数据库表**：`SystemConfig` 表已存在，包含 `key` 和 `value` 字段
2. **管理端接口**：`/v1/admin/system-config` 已实现，需要管理员权限
3. **客户端接口**：目前缺失，客户端无法获取系统配置
4. **现有使用**：订单服务中已使用汇率配置（`exchange_rate`）

### 问题

- 客户端应用无法获取平台基础配置
- 配置信息硬编码在客户端或通过其他间接方式获取
- 缺乏统一的客户端配置获取接口

## 设计目标

### 功能需求

1. 提供客户端可访问的系统配置获取接口
2. 支持获取所有公开配置或单个配置项
3. 无需管理员权限，支持可选用户认证
4. 配置项白名单机制，过滤敏感信息
5. 提供配置项的标签和描述信息

### 非功能需求

1. 高性能：支持缓存机制
2. 安全性：只返回公开配置
3. 可维护性：易于扩展新的配置项
4. 兼容性：保持与现有管理端接口的兼容性

## 技术方案

### 后端架构

#### 模块结构

```
apps/api/src/client/system-config/
├── system-config.controller.ts      # 控制器
├── system-config.service.ts         # 服务
├── system-config.module.ts          # 模块
├── dto/
│   ├── system-config-response.dto.ts # 响应DTO
│   └── system-config-query.dto.ts    # 查询DTO（可选）
└── constants/
    └── client-config-whitelist.ts   # 客户端配置白名单
```

#### 接口设计

**1. 获取所有客户端配置**

```
GET /v1/client/system-config
```

**响应格式：**

```json
{
  "list": [
    {
      "key": "platform_name",
      "value": "Lucky Nest",
      "label": "Platform Name",
      "description": "平台显示名称",
      "dataType": "string"
    },
    {
      "key": "exchange_rate_usd_php",
      "value": "56.50",
      "label": "Exchange Rate (USD → PHP)",
      "description": "用于余额显示转换",
      "dataType": "number"
    }
  ]
}
```

**2. 获取单个配置项**

```
GET /v1/client/system-config/:key
```

**响应格式：**

```json
{
  "key": "exchange_rate_usd_php",
  "value": "56.50",
  "label": "Exchange Rate (USD → PHP)",
  "description": "用于余额显示转换",
  "dataType": "number"
}
```

**3. 批量获取配置项（可选）**

```
POST /v1/client/system-config/batch
Content-Type: application/json

{
  "keys": ["platform_name", "exchange_rate_usd_php"]
}
```

### 配置项白名单

#### 客户端可访问的配置项

```typescript
// 基础平台配置
export const CLIENT_CONFIG_WHITELIST = [
  // 汇率相关
  "exchange_rate_usd_php", // 汇率 USD→PHP
  "exchange_rate_php_usd", // 汇率 PHP→USD

  // 平台信息
  "platform_name", // 平台名称
  "platform_email", // 客服邮箱
  "web_base_url", // 网站基础URL

  // 提现配置
  "min_withdraw_amount", // 最小提现金额 (PHP)
  "max_withdraw_amount", // 最大提现金额 (PHP)
  "withdraw_fee_rate", // 提现手续费率 (%)

  // 安全与合规
  "kyc_required", // KYC要求 (1=必填, 0=可选)
  "kyc_and_phone_verification", // KYC和手机验证配置

  // 业务配置
  "charity_rate", // 慈善比例
  "robot_delay_seconds", // 机器人介入延迟（秒）

  // 功能开关
  "enable_group_chat", // 是否启用群聊
  "enable_lucky_draw", // 是否启用抽奖
  "enable_flash_sale", // 是否启用秒杀
];
```

#### 配置项元数据

```typescript
export const CLIENT_CONFIG_METADATA: Record<
  string,
  {
    label: string;
    description: string;
    dataType: "string" | "number" | "boolean" | "json";
    defaultValue?: string;
  }
> = {
  exchange_rate_usd_php: {
    label: "Exchange Rate (USD → PHP)",
    description: "Used for balance display conversion",
    dataType: "number",
  },
  platform_name: {
    label: "Platform Name",
    description: "平台显示名称",
    dataType: "string",
  },
  kyc_required: {
    label: "KYC Required",
    description: "1 = required, 0 = optional",
    dataType: "number",
    defaultValue: "1",
  },
  // ... 其他配置项
};
```

### 服务层设计

#### SystemConfigService

```typescript
@Injectable()
export class ClientSystemConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取所有客户端配置
   */
  async getAll(): Promise<ClientSystemConfigItem[]> {
    const configs = await this.prisma.systemConfig.findMany({
      where: {
        key: { in: CLIENT_CONFIG_WHITELIST },
      },
      orderBy: { key: "asc" },
    });

    return configs.map((config) => this.enrichConfig(config));
  }

  /**
   * 获取单个配置项
   */
  async getByKey(key: string): Promise<ClientSystemConfigItem> {
    // 检查是否在白名单中
    if (!CLIENT_CONFIG_WHITELIST.includes(key)) {
      throw new NotFoundException(
        `Config key "${key}" not found or not accessible`,
      );
    }

    const config = await this.prisma.systemConfig.findUnique({
      where: { key },
    });

    if (!config) {
      // 如果数据库中没有，返回默认值
      const metadata = CLIENT_CONFIG_METADATA[key];
      if (metadata?.defaultValue) {
        return {
          key,
          value: metadata.defaultValue,
          label: metadata.label,
          description: metadata.description,
          dataType: metadata.dataType,
        };
      }
      throw new NotFoundException(`Config key "${key}" not found`);
    }

    return this.enrichConfig(config);
  }

  /**
   * 批量获取配置项
   */
  async getBatch(keys: string[]): Promise<ClientSystemConfigItem[]> {
    // 过滤白名单
    const validKeys = keys.filter((key) =>
      CLIENT_CONFIG_WHITELIST.includes(key),
    );

    if (validKeys.length === 0) {
      return [];
    }

    const configs = await this.prisma.systemConfig.findMany({
      where: {
        key: { in: validKeys },
      },
    });

    // 创建配置项映射
    const configMap = new Map(configs.map((c) => [c.key, c]));

    return validKeys.map((key) => {
      const config = configMap.get(key);
      if (config) {
        return this.enrichConfig(config);
      } else {
        // 返回默认值
        const metadata = CLIENT_CONFIG_METADATA[key];
        return {
          key,
          value: metadata?.defaultValue || "",
          label: metadata?.label || key,
          description: metadata?.description || "",
          dataType: metadata?.dataType || "string",
        };
      }
    });
  }

  /**
   * 丰富配置项信息
   */
  private enrichConfig(config: SystemConfig): ClientSystemConfigItem {
    const metadata = CLIENT_CONFIG_METADATA[config.key] || {
      label: config.key,
      description: "",
      dataType: "string" as const,
    };

    return {
      key: config.key,
      value: config.value,
      label: metadata.label,
      description: metadata.description,
      dataType: metadata.dataType,
    };
  }
}
```

### 控制器层设计

#### SystemConfigController

```typescript
@Controller("client/system-config")
@UseGuards(OptionalJwtAuthGuard) // 可选认证
export class ClientSystemConfigController {
  constructor(private readonly service: ClientSystemConfigService) {}

  /**
   * 获取所有客户端配置
   */
  @Get()
  @ApiOperation({ summary: "获取所有客户端系统配置" })
  @ApiOkResponse({ type: [ClientSystemConfigResponseDto] })
  getAll() {
    return this.service.getAll();
  }

  /**
   * 获取单个配置项
   */
  @Get(":key")
  @ApiOperation({ summary: "获取单个客户端系统配置" })
  @ApiOkResponse({ type: ClientSystemConfigResponseDto })
  @ApiNotFoundResponse({ description: "配置项不存在或不可访问" })
  getByKey(@Param("key") key: string) {
    return this.service.getByKey(key);
  }

  /**
   * 批量获取配置项
   */
  @Post("batch")
  @ApiOperation({ summary: "批量获取客户端系统配置" })
  @ApiOkResponse({ type: [ClientSystemConfigResponseDto] })
  getBatch(@Body() dto: BatchSystemConfigQueryDto) {
    return this.service.getBatch(dto.keys);
  }
}
```

### 数据模型

#### 响应DTO

```typescript
export class ClientSystemConfigResponseDto {
  @ApiProperty({ description: "配置键" })
  key: string;

  @ApiProperty({ description: "配置值" })
  value: string;

  @ApiProperty({ description: "显示标签" })
  label: string;

  @ApiProperty({ description: "配置描述", required: false })
  description?: string;

  @ApiProperty({
    description: "数据类型",
    enum: ["string", "number", "boolean", "json"],
  })
  dataType: "string" | "number" | "boolean" | "json";
}
```

#### 批量查询DTO

```typescript
export class BatchSystemConfigQueryDto {
  @ApiProperty({
    description: "配置键列表",
    type: [String],
    example: ["platform_name", "exchange_rate_usd_php"],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  keys: string[];
}
```

### 前端集成

#### API客户端（admin-next）

```typescript
// apps/admin-next/src/api/index.ts
export const clientSystemConfigApi = {
  /**
   * 获取所有客户端配置
   */
  getAll: () =>
    http.get<{ list: ClientSystemConfigItem[] }>("/v1/client/system-config"),

  /**
   * 获取单个配置项
   */
  getByKey: (key: string) =>
    http.get<ClientSystemConfigItem>(`/v1/client/system-config/${key}`),

  /**
   * 批量获取配置项
   */
  getBatch: (keys: string[]) =>
    http.post<{ list: ClientSystemConfigItem[] }>(
      "/v1/client/system-config/batch",
      { keys },
    ),
};
```

#### TypeScript类型定义

```typescript
// apps/admin-next/src/type/types.ts
export interface ClientSystemConfigItem {
  key: string;
  value: string;
  label: string;
  description?: string;
  dataType: "string" | "number" | "boolean" | "json";
}

// 类型转换工具函数
export function parseSystemConfigValue<T>(item: ClientSystemConfigItem): T {
  switch (item.dataType) {
    case "number":
      return Number(item.value) as T;
    case "boolean":
      return (item.value === "1" || item.value.toLowerCase() === "true") as T;
    case "json":
      return JSON.parse(item.value) as T;
    default:
      return item.value as T;
  }
}
```

#### 使用示例

```typescript
// 在React组件中使用
import { clientSystemConfigApi, parseSystemConfigValue } from '@/api';

function AppHeader() {
  const [platformName, setPlatformName] = useState('Lucky Nest');

  useEffect(() => {
    // 获取平台名称
    clientSystemConfigApi.getByKey('platform_name')
      .then(config => {
        setPlatformName(config.value);
      });

    // 批量获取配置
    clientSystemConfigApi.getBatch(['exchange_rate_usd_php', 'kyc_required'])
      .then(({ list }) => {
        const exchangeRate = parseSystemConfigValue<number>(
          list.find(item => item.key === 'exchange_rate_usd_php')!
        );
        const kycRequired = parseSystemConfigValue<boolean>(
          list.find(item => item.key === 'kyc_required')!
        );

        console.log('Exchange rate:', exchangeRate);
        console.log('KYC required:', kycRequired);
      });
  }, []);

  return <h1>{platformName}</h1>;
}
```

## 实施步骤

### 阶段一：后端实现（预计：2-3小时）

1. **创建目录结构**

   ```
   mkdir -p apps/api/src/client/system-config/{dto,constants}
   ```

2. **创建常量文件**
   - `client-config-whitelist.ts`：配置项白名单
   - `client-config-metadata.ts`：配置项元数据

3. **创建DTO文件**
   - `system-config-response.dto.ts`：响应DTO
   - `system-config-query.dto.ts`：查询DTO

4. **创建服务文件**
   - `system-config.service.ts`：业务逻辑

5. **创建控制器文件**
   - `system-config.controller.ts`：API端点

6. **创建模块文件**
   - `system-config.module.ts`：NestJS模块

7. **注册模块**
   - 在 `apps/api/src/client/client.module.ts` 中导入新模块

### 阶段二：前端集成（预计：1小时）

1. **更新API客户端**
   - 在 `apps/admin-next/src/api/index.ts` 中添加客户端系统配置API

2. **添加类型定义**
   - 在 `apps/admin-next/src/type/types.ts` 中添加相关类型

3. **创建工具函数**
   - 添加配置值解析工具函数

### 阶段三：测试与验证（预计：1-2小时）

1. **单元测试**
   - 服务层测试
   - 控制器测试

2. **集成测试**
   - API端点测试
   - 数据库查询测试

3. **手动测试**
   - 使用Postman或curl测试接口
   - 验证前端集成

### 阶段四：部署与监控（预计：1小时）

1. **更新API文档**
   - 添加Swagger文档
   - 更新API接口文档

2. **监控配置**
   - 添加日志记录
   - 配置性能监控

## 性能优化

### 缓存策略

```typescript
// 使用Redis缓存配置
@Injectable()
export class ClientSystemConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getAll(): Promise<ClientSystemConfigItem[]> {
    const cacheKey = "client:system-config:all";

    // 尝试从缓存获取
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // 从数据库获取
    const configs = await this.prisma.systemConfig.findMany({
      where: {
        key: { in: CLIENT_CONFIG_WHITELIST },
      },
      orderBy: { key: "asc" },
    });

    const result = configs.map((config) => this.enrichConfig(config));

    // 缓存结果（5分钟）
    await this.redis.set(cacheKey, JSON.stringify(result), "EX", 300);

    return result;
  }
}
```

### 数据库优化

1. 为 `SystemConfig.key` 字段添加索引（如果尚未添加）
2. 使用批量查询减少数据库调用
3. 考虑配置项的分页查询（如果配置项数量很多）

## 安全考虑

### 权限控制

1. **白名单机制**：只返回允许客户端访问的配置项
2. **可选认证**：使用 `OptionalJwtAuthGuard`，支持有用户和无用户两种场景
3. **速率限制**：添加API调用频率限制

### 数据验证

1. **输入验证**：验证配置键的格式
2. **输出过滤**：确保返回的数据格式正确
3. **错误处理**：统一的错误响应格式

## 扩展性考虑

### 未来扩展功能

1. **配置分组**：支持按类别分组返回配置
2. **多语言支持**：配置项的标签和描述支持多语言
3. **配置版本控制**：支持配置变更历史记录
4. **客户端配置热更新**：支持WebSocket推送配置变更
5. **环境特定配置**：支持不同环境（开发、测试、生产）的配置

### 配置项管理

1. **配置项注册机制**：新的配置项可以通过装饰器或配置文件注册
2. **配置项验证**：添加配置值的格式验证
3. **配置项依赖**：支持配置项之间的依赖关系

## 迁移计划

### 数据迁移

1. **现有配置项检查**：确保所有客户端需要的配置项已存在于数据库中
2. **默认值设置**：为缺失的配置项设置合理的默认值
3. **数据清理**：清理无效或过期的配置项

### 客户端迁移

1. \*\*
