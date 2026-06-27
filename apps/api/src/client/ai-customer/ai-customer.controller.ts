import { Controller, Post, Body, UseGuards, HttpCode } from '@nestjs/common';
import { AiCustomerService } from './ai-customer.service';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { TestChatDto } from '@api/client/ai-customer/dto/test-chat.dto';

@ApiTags('AI Customer')
@Controller('ai/customer')
export class AiCustomerController {
  constructor(private readonly aiCustomerService: AiCustomerService) {}

  /**
   * Test AI customer intent classification
   * @param dto
   * @param userId
   * 用户输入: "帮我查看订单"
   *         ↓
   * intentRouter → intent: 'order'
   *         ↓
   * orderAgent (手动循环)
   *   ├─ 第1轮: LLM 调用 getUserOrders(userId)
   *   │    ├─ orderService.listOrders() → raw DB data
   *   │    ├─ toLLM() → 语义化 { "订单编号": "202406010001", "订单状态": "已支付", ... }
   *   │    └─ ToolMessage 返回给 LLM
   *   ├─ 第2轮: LLM 调用 getOrderInfo(userId, orderId)
   *   │    ├─ 同上流程
   *   │    └─ ToolMessage
   *   └─ LLM 不调用工具 → break
   *         ↓
   * agentOutput: "您共有3个订单：\n1. 订单号 202406010001 - 已支付 - ¥9.98 - 2024/1/1\n..."
   *         ↓
   * answerSynthesizer → "亲，您目前有3个订单。其中订单 202406010001 已支付，实付金额 ¥9.98..."
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('test-chat')
  @HttpCode(200)
  @ApiOperation({ summary: 'Test AI customer intent classification' })
  async testChat(@Body() dto: TestChatDto, @CurrentUserId() userId: string) {
    return this.aiCustomerService.testChat(dto.message, userId);
  }
}
