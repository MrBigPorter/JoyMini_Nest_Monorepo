import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsOptional,
  IsNotEmpty,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({
    description: 'Comment content',
    minLength: 1,
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty({ message: 'Comment content cannot be empty' })
  @MinLength(1, { message: 'Comment content must be at least 1 character' })
  @MaxLength(2000, { message: 'Comment content cannot exceed 2000 characters' })
  content!: string;

  @ApiPropertyOptional({ description: 'Parent comment ID for replies' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({
    description: 'Author nickname (required for anonymous comments)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Nickname cannot exceed 100 characters' })
  author?: string;

  @ApiPropertyOptional({
    description: 'Author email (optional for anonymous comments)',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Invalid email format' })
  @MaxLength(100, { message: 'Email cannot exceed 100 characters' })
  email?: string;

  @ApiPropertyOptional({
    description: 'Author website (optional for anonymous comments)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Website cannot exceed 255 characters' })
  website?: string;
}
