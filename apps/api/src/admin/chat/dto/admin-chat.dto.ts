import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QueryMessagesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cursor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 30;
}

export class AdminReplyDto {
  /** 消息内容：text=文本, image/file/audio/video=CDN URL */
  @IsString()
  content!: string;

  /**
   * 消息类型，对齐 MESSAGE_TYPE：
   *   0=TEXT(default), 1=IMAGE, 2=AUDIO, 3=VIDEO, 5=FILE, 6=LOCATION
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  type?: number = 0;

  /** 附加元信息：图片尺寸 / 文件名称 / 音频时长等 */
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;

  /** 客服名称，展示给用户，默认 "Support" */
  @IsOptional()
  @IsString()
  agentName?: string;
}

export class AdminUploadTokenDto {
  @IsString()
  fileName!: string;

  @IsString()
  @Matches(/^(image|video|audio|application)\//, {
    message: 'Unsupported file type',
  })
  fileType!: string;
}

export class CloseConversationDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
