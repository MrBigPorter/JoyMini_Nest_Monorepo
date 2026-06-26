import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { AiCustomerService } from './ai-customer.service';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';

@Controller('ai-customer')
export class AiCustomerController {
  constructor(private readonly aiCustomerService: AiCustomerService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('test-chat')
  @HttpCode(200)
  async testChat(
    @Body('message') message: string,
    @CurrentUserId() userId: string,
  ) {
    return this.aiCustomerService.testChat(message, userId);
  }
}
