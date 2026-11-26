import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { PaymentChannelDto } from './payment-channel.dto';

function toDto(overrides: Record<string, unknown> = {}) {
  return plainToInstance(PaymentChannelDto, {
    id: 1,
    code: 'PH_GCASH_WITHDRAW',
    name: 'GCash Withdraw',
    type: 2,
    minAmount: new Prisma.Decimal('100.00'),
    maxAmount: new Prisma.Decimal('50000.00'),
    feeFixed: new Prisma.Decimal('5.00'),
    feeRate: new Prisma.Decimal('0.0080'),
    status: 1,
    ...overrides,
  });
}

describe('支付渠道 DTO 数值精度', () => {
  // 列定义是 Decimal(5,4)：0.0080 是合法的 0.8%。
  // 若按 2 位小数输出会变成 "0.01"，把 0.8% 显示成 1%，
  // 真值校验与后台显示都会读到错误的费率。
  it('费率保留 4 位小数，不被四舍五入', () => {
    expect(toDto().feeRate).toBe('0.0080');
    expect(toDto({ feeRate: new Prisma.Decimal('0.01') }).feeRate).toBe('0.0100');
    expect(toDto({ feeRate: new Prisma.Decimal('0') }).feeRate).toBe('0.0000');
  });

  it('金额字段仍按 2 位小数输出', () => {
    const dto = toDto();
    expect(dto.minAmount).toBe('100.00');
    expect(dto.maxAmount).toBe('50000.00');
    expect(dto.feeFixed).toBe('5.00');
  });
});
