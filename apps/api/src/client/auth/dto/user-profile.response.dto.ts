import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { DateToTimestamp, MaskString } from '@api/common/dto/transforms';
import { FieldMeta } from '@lucky/shared';

@Exclude()
export class UserProfileResponseDto {
  @FieldMeta({ label: { zh: '用户ID', en: 'User ID' } })
  @ApiProperty({ example: 'cmippru8j0000pic3giq0fgc4' })
  @Expose()
  id!: string;

  @FieldMeta({ label: { zh: '手机号', en: 'Phone' } })
  @ApiProperty({ example: '+639171234567' })
  @Expose()
  @MaskString('phone')
  phone!: string;

  @ApiProperty({ example: 'e10adc3949ba59abbe56e057f20f883e' })
  @Expose()
  phoneMd5!: string;

  @FieldMeta({ label: { zh: '昵称', en: 'Nickname' } })
  @ApiProperty({ example: 'Porter' })
  @Expose()
  nickname!: string;

  @ApiPropertyOptional({
    example: 'https://cdn.xxx.com/avatar/1.png',
    nullable: true,
  })
  @Expose()
  avatar!: string | null;

  @FieldMeta({ label: { zh: '邀请码', en: 'Invite Code' } })
  @ApiProperty({ example: 'ABCD12' })
  @Expose()
  inviteCode!: string;

  @FieldMeta({
    label: { zh: 'VIP等级', en: 'VIP Level' },
    enum: {
      0: { zh: '普通会员', en: 'Normal' },
      1: { zh: 'VIP1', en: 'VIP1' },
      2: { zh: 'VIP2', en: 'VIP2' },
      3: { zh: 'VIP3', en: 'VIP3' },
    },
  })
  @ApiProperty({ example: 0, description: 'VIP level (0=normal)' })
  @Expose()
  vipLevel!: number;

  @FieldMeta({
    label: { zh: 'KYC实名状态', en: 'KYC Status' },
    enum: {
      0: { zh: '待审核', en: 'Pending' },
      1: { zh: '审核中', en: 'Review' },
      2: { zh: '已通过', en: 'Approved' },
      3: { zh: '已拒绝', en: 'Rejected' },
    },
  })
  @ApiProperty({
    example: 1,
    description: 'KYC status (0=Pending,1=Review,2=Approved,3=Rejected)',
  })
  @Expose()
  kycStatus!: number;

  @FieldMeta({ label: { zh: '最后登录时间', en: 'Last Login' }, type: 'date' })
  @ApiProperty({ description: 'Last login timestamp (ms)', nullable: true })
  @Expose()
  @DateToTimestamp()
  lastLoginAt!: number | null;

  @FieldMeta({
    label: { zh: '自我排除到期时间', en: 'Self-Exclusion Expiry' },
    type: 'date',
  })
  @ApiProperty({
    example: '199009999',
    nullable: true,
    description: 'Self-exclusion expiry date',
  })
  @Expose()
  @DateToTimestamp()
  selfExclusionExpireAt!: Date | null;
}
