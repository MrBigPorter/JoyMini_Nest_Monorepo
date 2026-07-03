import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FieldMeta } from '@lucky/shared';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  IsInt,
  Min,
  Matches,
  Max,
} from 'class-validator';
import { Exclude, Expose, Type } from 'class-transformer';
import { PaginatedResponseDto } from '@api/common/dto/paginated-response.dto';
import {
  DateToTimestamp,
  IsSmartPhone,
  ToInt,
} from '@api/common/dto/transforms';

@Exclude()
export class CreateAddressDto {
  @ApiPropertyOptional({ description: 'Last name', maxLength: 50 })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  @Expose()
  lastName?: string;

  @ApiPropertyOptional({ description: 'First name', maxLength: 50 })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  @Expose()
  firstName?: string;

  @ApiProperty({ description: 'Contact name', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Expose()
  contactName!: string;

  @ApiProperty({ description: 'Phone number', maxLength: 20 })
  @IsString()
  @IsNotEmpty()
  @IsSmartPhone()
  @Expose()
  phone!: string;

  @ApiProperty({ description: 'Province ID' })
  @IsNotEmpty()
  @ToInt()
  @IsInt()
  @Min(1)
  @Expose()
  provinceId!: number;

  @ApiProperty({ description: 'City ID' })
  @IsNotEmpty()
  @ToInt()
  @IsInt()
  @Min(1)
  @Expose()
  cityId!: number;

  @ApiProperty({ description: 'Barangay ID' })
  @IsNotEmpty()
  @ToInt()
  @IsInt()
  @Min(1)
  @Expose()
  barangayId!: number;

  @ApiProperty({ description: 'Full address', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @Expose()
  fullAddress!: string;

  @ApiPropertyOptional({ description: 'Postal code', maxLength: 12 })
  @IsString()
  @IsOptional()
  @MaxLength(12)
  @Expose()
  postalCode?: string;

  @ApiPropertyOptional({
    description: 'Address label (e.g., Home, Office)',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Expose()
  label?: string;

  @ApiPropertyOptional({ description: 'Is default address', default: 0 })
  @IsOptional()
  @ToInt()
  @IsInt()
  @Min(0)
  @Max(1)
  @Expose()
  isDefault?: number;
}

export class UpdateAddressDto extends CreateAddressDto {}

export class DeleteAddressDto {
  @ApiProperty({ description: 'Address ID to delete' })
  @IsNotEmpty()
  @ToInt()
  @IsInt()
  @Min(1)
  addressId!: string;
}

export class QueryAddressListDto {
  @ApiProperty({ description: 'Page number', example: 1 })
  @IsNotEmpty()
  @ToInt()
  @IsInt()
  @Min(1)
  page!: number;

  @ApiProperty({ description: 'Page size', example: 10 })
  @IsNotEmpty()
  @ToInt()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize!: number;
}

@Exclude()
export class AddressResponseDto {
  @FieldMeta({ label: { zh: '地址ID', en: 'Address ID' } })
  @ApiProperty({ description: 'Address ID' })
  @Expose()
  addressId!: string;

  @FieldMeta({ label: { zh: '联系人', en: 'Contact Name' } })
  @ApiProperty({ description: 'Contact Name' })
  @Expose()
  contactName?: string;

  @FieldMeta({ label: { zh: '省/区', en: 'Province' } })
  @ApiProperty({ description: 'Province Name' })
  @Expose()
  province!: string;

  @FieldMeta({ label: { zh: '市', en: 'City' } })
  @ApiProperty({ description: 'City Name' })
  @Expose()
  city!: string;

  @FieldMeta({ label: { zh: '区/村', en: 'Barangay' } })
  @ApiProperty({ description: 'Barangay Name' })
  @Expose()
  barangay!: string;

  @FieldMeta({ label: { zh: '详细地址', en: 'Full Address' } })
  @ApiProperty({ description: 'Full Address' })
  @Expose()
  fullAddress!: string;

  @FieldMeta({ label: { zh: '联系电话', en: 'Phone' } })
  @ApiProperty({ description: 'Phone Number' })
  @Expose()
  phone!: string;

  @FieldMeta({ label: { zh: '地址标签', en: 'Label' } })
  @ApiProperty({ description: 'Label' })
  @Expose()
  label?: string;

  @ApiProperty({ description: 'Province ID' })
  @Expose()
  provinceId!: number;

  @ApiProperty({ description: 'City ID' })
  @Expose()
  cityId!: number;

  @ApiProperty({ description: 'Barangay ID' })
  @Expose()
  barangayId!: number;

  @FieldMeta({ label: { zh: '邮政编码', en: 'Postal Code' } })
  @ApiProperty({ description: 'Postal Code' })
  @Expose()
  postalCode!: string;

  @FieldMeta({
    label: { zh: '是否默认', en: 'Is Default' },
    enum: {
      0: { zh: '否', en: 'No' },
      1: { zh: '是', en: 'Yes' },
    },
  })
  @ApiProperty({ description: 'Is default' })
  @Expose()
  isDefault!: number;
}

export class AddressListResponseDto extends PaginatedResponseDto<AddressResponseDto> {
  @ApiProperty({ isArray: true, type: AddressResponseDto })
  override list!: AddressResponseDto[];
}
