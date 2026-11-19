import { IsString, Length } from 'class-validator';
import { IsSmartPhone } from '@api/common/dto/transforms';

export class OtpRequestDto {
  @IsSmartPhone()
  phone!: string;
}

export class OtpVerifyDto {
  @IsSmartPhone()
  phone!: string;

  @IsString()
  @Length(4, 8) // 6 位为主，这里放宽到 4~8 方便你以后调整
  code!: string;
}
