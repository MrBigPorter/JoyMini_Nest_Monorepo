import {
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  IsBoolean,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MessageMetaDto {
  @ApiProperty({
    description: '视觉指纹算法生成的 Hash 字符串',
    required: false,
  })
  @IsOptional()
  @IsString()
  blurHash?: string;

  @ApiProperty({ description: '原始逻辑宽度', required: false })
  @IsOptional()
  @IsNumber()
  w?: number;

  @ApiProperty({ description: '原始逻辑高度', required: false })
  @IsOptional()
  @IsNumber()
  h?: number;

  @ApiProperty({ description: '媒体时长 (秒/毫秒)', required: false })
  @IsOptional()
  @IsInt()
  duration?: number;

  @ApiProperty({ description: '封面图/缩略图的远程路径', required: false })
  @IsOptional()
  @IsString()
  thumb?: string;

  @ApiProperty({
    description: '本地资产 ID (仅用于前端回显引用)',
    required: false,
  })
  @IsOptional()
  @IsString()
  localAssetId?: string;

  // =========================================================
  //  新增：文件消息 (File) 专用字段
  // =========================================================
  @ApiProperty({ description: '文件名 (e.g. report.pdf)', required: false })
  @IsOptional()
  @IsString()
  fileName?: string;

  @ApiProperty({ description: '文件大小 (字节)', required: false })
  @IsOptional()
  @IsInt() // 大小应该是整数
  fileSize?: number;

  @ApiProperty({ description: '文件后缀 (e.g. pdf)', required: false })
  @IsOptional()
  @IsString()
  fileExt?: string;

  // =========================================================
  // 新增：位置消息 (Location) 专用字段
  // =========================================================
  @ApiProperty({ description: '纬度', required: false })
  @IsOptional()
  @IsNumber() // 浮点数
  latitude?: number;

  @ApiProperty({ description: '经度', required: false })
  @IsOptional()
  @IsNumber() // 浮点数
  longitude?: number;

  @ApiProperty({ description: '具体地址字符串', required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ description: '位置名称/POI (e.g. 腾讯大厦)', required: false })
  @IsOptional()
  @IsString()
  title?: string;

  // =========================================================
  // 新增：客服代理发送审计字段
  // =========================================================
  @ApiProperty({ description: '是否为客服代理发送', required: false })
  @IsOptional()
  @IsBoolean()
  isSupport?: boolean;

  @ApiProperty({ description: '展示给用户的客服名称', required: false })
  @IsOptional()
  @IsString()
  agentName?: string;

  @ApiProperty({
    description: '实际后台操作员 adminId（审计字段）',
    required: false,
  })
  @IsOptional()
  @IsString()
  realAdminId?: string;

  // =========================================================
  // 新增：通话结束消息专用字段
  // =========================================================
  @ApiProperty({ description: '通话类型 (audio/video)', required: false })
  @IsOptional()
  @IsString()
  callType?: string;

  @ApiProperty({ description: '通话开始时间戳（毫秒）', required: false })
  @IsOptional()
  @IsNumber()
  startedAt?: number;

  @ApiProperty({ description: '通话会话ID', required: false })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiProperty({ description: '通话结束原因', required: false })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ description: '是否为系统生成的通话结束消息', required: false })
  @IsOptional()
  @IsBoolean()
  isSystemCallEnd?: boolean;
}
