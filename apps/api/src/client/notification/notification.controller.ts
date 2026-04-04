import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { NotificationService } from '@api/client/notification/notification.service';
import { OptionalJwtAuthGuard } from '@api/common/jwt/option-jwt.guard';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { RegisterDeviceDto } from '@api/client/notification/dto/register-device.dto';
import {
  SendBroadcastDto,
  SendTestDto,
} from '@api/client/notification/dto/send-test.dto';

@UseGuards(OptionalJwtAuthGuard)
@Controller('/client/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // 1. 匿名/登录通用上报接口
  // Flutter 端每次 App 启动，或者登录/退出时调用
  @Post('device/register')
  async registerDevice(
    @Body() body: RegisterDeviceDto,
    @CurrentUserId() userId: string | null,
  ) {
    await this.notificationService.registerDevice(
      body.token,
      body.platform,
      userId ?? undefined,
    );
    return { success: true };
  }

  // 2. (测试用) 手动触发一条推送
  @Post('test/send')
  async sendTest(@Body() body: SendTestDto) {
    await this.notificationService.sendPrivateMessage(
      body.userId,
      body.title,
      body.body,
    );
    return { success: true };
  }

  // 3. (测试用) 手动触发全员广播
  @Post('test/broadcast')
  async testBroadcast(@Body() body: SendBroadcastDto) {
    // 调用 Service 里的广播方法
    const result = await this.notificationService.sendBroadcast(
      body.title,
      body.body,
    );

    return {
      success: true,
      message: '广播任务已提交给 Firebase',
      result,
    };
  }
}
