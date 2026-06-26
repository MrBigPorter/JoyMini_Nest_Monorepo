import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { AiCustomerService } from './ai-customer.service';

@Controller('ai-customer')
export class AiCustomerController {
  constructor(private readonly aiCustomerService: AiCustomerService) {}

  /**
   * Test endpoint — classify user intent
   * POST /ai-customer/test-intent
   */
  @Post('test-intent')
  async testIntent(@Body('message') message: string) {
    return this.aiCustomerService.testIntent(message);
  }
}
