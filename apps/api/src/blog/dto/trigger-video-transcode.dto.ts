import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TriggerVideoTranscodeDto {
  @ApiProperty({
    description: 'R2 key of the video file (e.g., videos/uuid.MP4)',
  })
  @IsString()
  @IsNotEmpty()
  videoKey!: string;
}
