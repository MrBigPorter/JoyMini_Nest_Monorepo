import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';

@Injectable()
export class ClientSystemConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll() {
    const configs = await this.prisma.systemConfig.findMany({
      orderBy: { key: 'asc' },
    });

    return { list: configs };
  }

  async getEnabledLocales() {
    // 从系统配置获取已启用的语言代码
    const enabledConfig = await this.prisma.systemConfig.findUnique({
      where: { key: 'enabled_locales' },
    });

    const enabledCodes = enabledConfig?.value
      ? (JSON.parse(enabledConfig.value) as string[])
      : ['zh', 'en']; // 默认启用中英文

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
}
