import { CallEndReason, CallMediaType } from '@lucky/shared';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

// 0. 基础载荷 (所有信令的父类)
export class BaseCallDto {
  @IsUUID()
  @IsNotEmpty()
  sessionId!: string; // 唯一通话 ID (前端生成 UUID v4)

  @IsString()
  @IsNotEmpty()
  targetId!: string; // 接收方 ID
}

//  1. 发起呼叫 (Invite)
export class CallInviteDto extends BaseCallDto {
  @IsEnum(CallMediaType)
  mediaType!: CallMediaType;

  @IsString()
  @IsNotEmpty()
  sdp!: string; // WebRTC Offer SDP
}

// 2. 接听呼叫 (Accept)
export class CallAcceptDto extends BaseCallDto {
  @IsString()
  @IsNotEmpty()
  sdp!: string; // WebRTC Answer SDP
}

//  3. ICE 候选者 (Exchange)
export class CallIceCandidateDto extends BaseCallDto {
  @IsString()
  @IsNotEmpty()
  candidate!: string;

  @IsString()
  @IsNotEmpty()
  sdpMid!: string;

  @IsNumber()
  sdpMLineIndex!: number;
}

//  4. 拒绝/结束/取消 (End/Reject/Cancel)
export class CallEndDto extends BaseCallDto {
  @IsEnum(CallEndReason)
  reason!: CallEndReason;

  @IsString()
  @IsOptional()
  conversationId?: string;

  @IsEnum(CallMediaType)
  @IsOptional()
  mediaType?: CallMediaType; // 通话类型：audio或video

  @IsNumber()
  @Min(0)
  @IsOptional()
  duration?: number; // 通话时长（秒）

  @IsNumber()
  @Min(0)
  @IsOptional()
  startedAt?: number; // 开始时间戳（毫秒）
}

//  5. 对方已响铃 (Ringing) - 仅需基础信息
export class CallRingingDto extends BaseCallDto {}
