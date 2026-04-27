import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { CreateSystemConfigDto } from './dto/create-system-config.dto';

@Injectable()
export class SystemConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getAll() {
    const configs = await this.prisma.systemConfig.findMany({
      orderBy: { key: 'asc' },
    });
    return { list: configs };
  }

  async update(key: string, dto: UpdateSystemConfigDto) {
    const existing = await this.prisma.systemConfig.findUnique({
      where: { key },
    });

    if (!existing) {
      // 配置不存在，自动创建
      return this.prisma.systemConfig.create({
        data: {
          key,
          value: dto.value,
        },
      });
    }

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
      orderBy: { key: 'asc' },
    });

    return { list: configs };
  }

  /**
   * 获取单个配置值，带类型安全和默认值
   * 如果配置不存在，会自动创建默认配置
   */
  async get<T>(key: string, defaultValue: T): Promise<T> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key },
    });

    if (!config) {
      // 自动创建缺失的配置项
      try {
        await this.prisma.systemConfig.create({
          data: {
            key,
            value: JSON.stringify(defaultValue),
          },
        });
      } catch (error) {
        // 创建失败（如并发创建），仍然返回默认值
        console.warn(`Failed to create config ${key}:`, error);
      }
      return defaultValue;
    }

    try {
      return JSON.parse(config.value) as T;
    } catch {
      return defaultValue;
    }
  }

  /**
   * 获取已启用的语言列表
   */
  async getEnabledLocales() {
    const enabledCodes = await this.get<string[]>('enabled_locales', [
      'zh',
      'en',
    ]);

    const ALL_LOCALES = [
      { code: 'zh', name: '中文', nativeName: '简体中文', isDefault: true },
      { code: 'en', name: 'English', nativeName: 'English', isDefault: false },
      { code: 'ja', name: '日本語', nativeName: '日本語', isDefault: false },
      { code: 'ko', name: '한국어', nativeName: '한국어', isDefault: false },
      {
        code: 'fr',
        name: 'Français',
        nativeName: 'Français',
        isDefault: false,
      },
      { code: 'de', name: 'Deutsch', nativeName: 'Deutsch', isDefault: false },
    ];

    return {
      list: ALL_LOCALES.map((locale) => ({
        ...locale,
        enabled: enabledCodes.includes(locale.code),
      })),
    };
  }

  /**
   * 切换指定语言的启用状态
   */
  async toggleLocale(code: string, enabled: boolean) {
    const enabledCodes = await this.get<string[]>('enabled_locales', [
      'zh',
      'en',
    ]);

    if (code === 'zh') {
      // 默认语言不可关闭
      return { success: true };
    }

    const newEnabledCodes = enabled
      ? [...new Set([...enabledCodes, code])]
      : enabledCodes.filter((c) => c !== code);

    await this.prisma.systemConfig.upsert({
      where: { key: 'enabled_locales' },
      create: {
        key: 'enabled_locales',
        value: JSON.stringify(newEnabledCodes),
      },
      update: {
        value: JSON.stringify(newEnabledCodes),
      },
    });

    // 当新语言被启用时，发送事件触发全库翻译任务
    if (enabled) {
      this.eventEmitter
        .emitAsync('locale.enabled', code)
        .catch((err: unknown) => {
          // 静默失败，不影响主流程
        });
    }

    return { success: true };
  }
}
