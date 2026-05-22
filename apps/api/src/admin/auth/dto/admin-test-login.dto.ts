import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminTestLoginDto {
  @ApiProperty({
    description: 'test identifier (admin username)',
    example: 'demo_viewer',
  })
  @IsNotEmpty()
  @IsString()
  test!: string;

  @ApiProperty({ description: 'test verification code', example: 'test8888' })
  @IsNotEmpty()
  @IsString()
  code!: string;
}
