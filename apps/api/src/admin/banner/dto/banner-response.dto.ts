import { Exclude, Expose, Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

@Exclude() // Exclude all properties by default
export class BannerResponseDto {
  @ApiProperty({ description: 'Banner ID', example: 1 })
  @Expose()
  id!: number;

  @ApiProperty({
    description: 'Related title ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Expose()
  relatedTitleId?: string;

  @ApiProperty({ description: 'Banner title', example: 'Summer Sale' })
  @Expose()
  title!: string;

  @ApiProperty({
    description: 'Banner image URL',
    example: 'https://example.com/banner.jpg',
  })
  @Expose()
  bannerImgUrl!: string;

  @ApiProperty({ description: 'Blurhash placeholder', required: false })
  @Expose()
  blurhash?: string;

  @ApiProperty({
    description: 'File type, 1 pic 2 video',
    example: 1,
    enum: [1, 2],
  })
  @Expose()
  fileType!: number;

  @ApiProperty({
    description: 'Banner category, 1 home, 2 activity 3 product',
    example: 3,
    enum: [1, 2, 3],
  })
  @Expose()
  bannerCate!: number;

  @ApiProperty({
    description: 'Jump category, 1 no, 2 inner 3 external',
    example: 1,
    enum: [1, 2, 3],
  })
  @Expose()
  jumpCate?: number;

  @ApiProperty({ description: 'Jump URL', example: 'https://example.com' })
  @Expose()
  jumpUrl?: string;

  @ApiProperty({ description: 'Sort order', example: 1 })
  @Expose()
  sortOrder?: number;

  @ApiProperty({
    description: 'State, 1 active, 2 inactive',
    example: 1,
    enum: [1, 2],
  })
  @Expose()
  state?: number;

  @ApiProperty({
    description: 'Activity start time as timestamp',
    example: 1625097600,
  })
  @Expose()
  @Transform(({ value }) => {
    return value instanceof Date ? value.getTime() : value;
  })
  activityAtStart?: number;

  @ApiProperty({
    description: 'Activity end time as timestamp',
    example: 1627689600,
  })
  @Expose()
  @Transform(({ value }) => {
    return value instanceof Date ? value.getTime() : value;
  })
  activityAtEnd?: number;

  @ApiProperty({
    description: 'Creation time as timestamp',
    example: 1622505600,
  })
  @Expose()
  @Transform(({ value }) => {
    return value instanceof Date ? value.getTime() : value;
  })
  createdAt!: number;
}
