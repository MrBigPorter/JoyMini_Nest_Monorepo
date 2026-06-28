import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { DecimalToString } from '@api/common/dto/transforms';
import { FieldMeta } from '@lucky/shared';

@Exclude()
export class WalletBalanceResponseDto {
  @FieldMeta({ label: { zh: '钱包ID', en: 'Wallet ID' } })
  @ApiProperty({ example: 'wal_123456', description: 'Wallet ID' })
  @Expose()
  id!: string;

  @FieldMeta({ label: { zh: '用户ID', en: 'User ID' } })
  @ApiProperty({ example: 'user_123456', description: 'User ID' })
  @Expose()
  userId!: string;

  @FieldMeta({ label: { zh: '可用余额', en: 'Available Balance' }, type: 'amount' })
  @ApiProperty({ example: '1000.00', description: 'Available cash balance' })
  @Expose()
  @DecimalToString()
  realBalance!: string;

  @FieldMeta({ label: { zh: '累计充值', en: 'Total Recharge' }, type: 'amount' })
  @ApiProperty({ example: '1500.00', description: 'Total recharge amount' })
  @Expose()
  @DecimalToString()
  totalRecharge!: string;

  @FieldMeta({ label: { zh: '金币余额', en: 'Coin Balance' }, type: 'amount' })
  @ApiProperty({ example: '200.00', description: 'Coin balance' })
  @Expose()
  @DecimalToString()
  coinBalance!: string;

  @FieldMeta({ label: { zh: '冻结金额', en: 'Frozen Balance' }, type: 'amount' })
  @ApiProperty({ example: '0.00', description: 'Frozen cash balance' })
  @Expose()
  @DecimalToString()
  frozenBalance!: string;

  @FieldMeta({ label: { zh: '累计提现', en: 'Total Withdraw' }, type: 'amount' })
  @ApiProperty({ example: '0.00', description: 'Total withdraw amount' })
  @Expose()
  @DecimalToString()
  totalWithdraw!: string;
}
