import { Exclude, Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { FieldMeta } from '@lucky/shared';

@Exclude()
export class KycIdTypesResponseDto {
  @FieldMeta({ label: { zh: '证件类型 ID', en: 'ID Type ID' } })
  @ApiProperty({ description: 'ID type ID', example: 1 })
  @Expose()
  id!: number;

  @FieldMeta({ label: { zh: '类型编码', en: 'Code' } })
  @ApiProperty({ description: 'Unique code', example: 'PASSPORT' })
  @Expose()
  code!: string;

  @FieldMeta({ label: { zh: '类型名称', en: 'Type Name' } })
  @ApiProperty({ description: 'Display name', example: 'Passport' })
  @Expose({ name: 'label' })
  typeName!: string;

  @FieldMeta({ label: { zh: '需要正面照', en: 'Requires Front Photo' } })
  @ApiProperty({
    description: 'Whether front image is required',
    example: true,
  })
  @Expose()
  requiresFront!: boolean;

  @FieldMeta({ label: { zh: '需要反面照', en: 'Requires Back Photo' } })
  @ApiProperty({
    description: 'Whether back image is required',
    example: false,
  })
  @Expose()
  requiresBack!: boolean;

  @FieldMeta({ label: { zh: '需要 OCR', en: 'Requires OCR' } })
  @ApiProperty({ description: 'Whether OCR is required', example: true })
  @Expose()
  requiresOcr!: boolean;
}
