import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OtpRequestDto, OtpVerifyDto } from './otp.dto';
import { OtpService } from './otp.service';
import { RealIP } from '@api/common/decorators/real-ip.decorator';

@ApiTags('otp')
@Controller('otp')
export class OtpController {
  constructor(private readonly otp: OtpService) {}

  @Post('request')
  @Throttle({ otpRequest: { limit: 5, ttl: 60_000 } }) // 每 IP/手机号 60 秒 5 次
  @ApiOperation({ summary: 'request OTP' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { phone: { type: 'string', example: '9878129723' } },
      required: ['phone'],
    },
  })
  @ApiResponse({
    status: 10000,
    description: 'success',
    schema: {
      example: { code: 999999, message: 'success', tid: '...', data: null },
    },
  })
  async request(@Body() dto: OtpRequestDto, @RealIP() ip: string) {
    return await this.otp.request({ ...dto, requestIp: ip });
  }

  @Post('verify')
  @Throttle({ otpRequest: { limit: 10, ttl: 60_000 } }) //每 IP/手机号 60 秒 10 次
  @ApiOperation({ summary: 'verify OTP' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', example: '9878129723' },
        code: { type: 'string', example: '123456' },
      },
      required: ['phone', 'code'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'verify success, return 9999',
    schema: {
      example: { code: 10000, message: 'success', tid: '...', data: '9999' },
    },
  })
  async verify(@Body() dto: OtpVerifyDto) {
    return await this.otp.verify(dto);
  }
}
