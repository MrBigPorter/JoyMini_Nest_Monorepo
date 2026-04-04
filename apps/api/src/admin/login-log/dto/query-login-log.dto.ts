import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryLoginLogDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  /** 按用户 ID 筛选 */
  @IsOptional()
  @IsString()
  userId?: string;

  /** 按 IP 筛选 */
  @IsOptional()
  @IsString()
  loginIp?: string;

  /** 登录方式: password/google/facebook */
  @IsOptional()
  @IsString()
  loginMethod?: string;

  /** 登录状态: 1=成功 0=失败 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  loginStatus?: number;

  /** 起始时间 ISO 字符串 */
  @IsOptional()
  @IsString()
  startDate?: string;

  /** 结束时间 ISO 字符串 */
  @IsOptional()
  @IsString()
  endDate?: string;
}
