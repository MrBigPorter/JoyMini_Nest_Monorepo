import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { TreasureController } from '@api/client/treasure/treasure.controller';
import { TreasureService } from '@api/client/treasure/treasure.service';
import { RedisModule } from '@api/common/redis/redis.module';
import { ShareController } from '@api/client/treasure/share.controller';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [TreasureController, ShareController],
  providers: [TreasureService],
  exports: [TreasureService],
})
export class TreasureModule {}
