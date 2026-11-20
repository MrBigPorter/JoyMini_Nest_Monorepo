import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterFlowDefinitionDto {
  @IsString()
  @MaxLength(32)
  flowType!: string;

  @IsObject()
  payload!: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  createdBy?: string;
}

export class BindFlowDto {
  @IsString()
  @MaxLength(64)
  conversationId!: string;

  @IsString()
  @MaxLength(32)
  flowType!: string;

  @IsOptional()
  @IsString()
  threadId?: string;
}

export class RollbackStateDto {
  @IsString()
  @MaxLength(64)
  conversationId!: string;

  @IsString()
  @MaxLength(128)
  checkpointId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  flowType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SwitchFlowDefinitionDto {
  @IsString()
  @MaxLength(64)
  conversationId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  flowType?: string;

  @IsString()
  @MaxLength(64)
  toVersionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
