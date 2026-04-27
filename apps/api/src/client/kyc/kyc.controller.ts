import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { KycService } from '@api/client/kyc/kyc.service';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { plainToInstance } from 'class-transformer';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { SubmitKycDto } from '@api/client/kyc/dto/submit-kyc.dto';
import { KycIdTypesResponseDto } from '@api/client/kyc/dto/kyc-id-types.response.dto';
import { KycResponseDto } from '@api/client/kyc/dto/kyc.response.dto';
import { SessionResponseDto } from '@api/client/kyc/dto/session.response.dto';
import { Throttle } from '@nestjs/throttler';
import { RedisLockService } from '@api/common/redis/redis-lock.service';
import { DistributedLock } from '@api/common/decorators/distributed-lock.decorator';
import { DeviceSecurityGuard } from '@api/common/guards/device-security.guard';
import {
  DeviceSecurity,
  DeviceSecurityLevel,
} from '@api/common/decorators/device-security.decorator';
import {
  CurrentDevice,
  DeviceInfo,
} from '@api/common/decorators/http.decorators';
import { UploadService } from '@api/common/upload/upload.service';
import { KycOcrResponseDto } from '@api/client/kyc/dto/kyc-id-card-orc.dto';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';

@ApiTags('KYC')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, DeviceSecurityGuard)
@DeviceSecurity(DeviceSecurityLevel.LOG_ONLY)
@Controller('kyc')
export class KycController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly kycService: KycService,
    public readonly lockService: RedisLockService,
  ) {}

  /**
   * Create a liveness detection session for the user
   * @param userId
   */
  @Post('session')
  @HttpCode(HttpStatus.OK)
  @Throttle({ kycSessionRequest: { limit: 1, ttl: 60_000 } })
  @DistributedLock('kyc:session:create:{0}', 15000) // 每用户每 15 秒只能创建一次
  @ApiOkResponse({ type: SessionResponseDto })
  async createSession(@CurrentUserId() userId: string) {
    const session = await this.kycService.createSession(userId);
    return plainToInstance(SessionResponseDto, session);
  }

  /**
   * OCR scan for ID card upload
   * @param file
   * @param userId
   */
  @Post('ocr-scan')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data') // Swagger 文件上传标识
  @UseInterceptors(FileInterceptor('file'))
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @DistributedLock('kyc:ocr-scan:{0}', 10000) // 每用户每 10 秒只能请求一次 OCR 扫描
  @ApiOkResponse({ type: KycOcrResponseDto })
  scanOcr(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUserId() userId: string,
  ) {
    if (!file) {
      throw new NotFoundException('File not found');
    }
    const result = this.kycService.scanIdCard(file.buffer);
    return plainToInstance(KycOcrResponseDto, result);
  }

  /**
   * Get my KYC record
   * @param userId
   */
  @Get('me')
  @ApiOkResponse({ type: KycResponseDto })
  async me(@CurrentUserId() userId: string) {
    const record = await this.kycService.getMyKyc(userId);
    return plainToInstance(KycResponseDto, record);
  }

  /**
   * Get active ID types
   */
  @Get('id-types')
  @ApiProperty({ type: [KycIdTypesResponseDto] })
  async getIdTypes() {
    const idTypes = await this.kycService.getIdTypes();
    return plainToInstance(KycIdTypesResponseDto, idTypes);
  }

  /**
   * Submit KYC information
   * keyPattern: 'kyc:submit:{0}'
   * - {0} 表示第一个参数 (userId)
   * - 这样每个用户只能并发提交一次，互不影响
   * * 包含：文件上传 S3 + AWS 活体校验 + 人证比对 + 数据入库
   */
  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data') // Swagger 文件上传标识
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'idCardFront', maxCount: 1 },
      { name: 'idCardBack', maxCount: 1 },
    ]),
  )
  @ApiBody({ type: SubmitKycDto })
  @ApiOkResponse({ type: KycResponseDto })
  @DistributedLock('kyc:submit:{0}', 10000) // 锁 10秒，因为涉及上传和 AI 校验
  async submitKyc(
    @CurrentUserId() userId: string,
    @Body() dto: SubmitKycDto,
    @UploadedFiles()
    files: {
      idCardFront?: Express.Multer.File[];
      idCardBack?: Express.Multer.File[];
    },
    @CurrentDevice() device: DeviceInfo,
  ) {
    // 校验必须上传正面照
    if (!files.idCardFront || files.idCardFront.length === 0) {
      throw new NotFoundException('ID Card Front image is required');
    }

    // 提取文件
    const idCardFrontFile = files.idCardFront[0];
    const idCardBackFile = files.idCardBack ? files.idCardBack[0] : null;

    const record = await this.kycService.submitKyc(
      userId,
      dto,
      idCardFrontFile,
      idCardBackFile,
      device,
    );
    return plainToInstance(KycResponseDto, record);
  }
}
