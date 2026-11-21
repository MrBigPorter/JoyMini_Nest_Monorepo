import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ToNumber } from '@api/common/dto/transforms';

export class ApplyWithdrawDto {
  @ApiProperty({ description: 'Withdrawal amount', example: 150.75 })
  @IsNotEmpty()
  @IsNumber()
  @Min(100, { message: 'Minimum withdrawal amount is 100' })
  amount!: number;

  @ApiProperty({ description: 'Withdrawal account', example: '1234567890' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  account!: string;

  @ApiProperty({ description: 'Account holder name', example: 'John Doe' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  accountName!: string;

  @ApiProperty({ description: 'Payment channel ID', example: 2 })
  @IsNotEmpty()
  @ToNumber()
  @IsNumber()
  channelId!: number;

  @ApiProperty({
    description: 'Bank name (required if method is Bank)',
    example: 'Bank of Examples',
    required: false,
  })
  @IsOptional()
  @IsString()
  bankName?: string;

  /**
   * 短信验证码（WITHDRAW 类型）。
   *
   * 服务端在 WITHDRAW_OTP_ENFORCE=true 时强制要求；关闭时允许旧客户端不传，
   * 但会记录 withdraw_otp_missing_total 指标用于灰度观察。
   * 卡片路径不走本 DTO 的 OTP 字段（OTP 已在确认端点核销）。
   */
  @ApiProperty({
    description:
      'SMS OTP code for withdrawal (required when WITHDRAW_OTP_ENFORCE=true)',
    example: '123456',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  otpCode?: string;
}
