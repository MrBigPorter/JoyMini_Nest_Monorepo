import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { IntentDomainService } from './intent-domains.service';

/**
 * 意图域注册表（M0：只读 + 种子）。
 *
 * 审核/编辑接口在 M2b 接入；现在先把运行时读取与校验收口，
 * 让分类器、LLM 兜底 prompt、后台示例管理读同一份数据。
 */
@Module({
  imports: [PrismaModule],
  providers: [IntentDomainService],
  exports: [IntentDomainService],
})
export class IntentDomainsModule {}
