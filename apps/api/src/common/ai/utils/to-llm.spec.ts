import { ClaimableCouponResponseDto } from '@api/client/coupon/dto/claimable-coupon-response.dto';
import { toLLM } from './to-llm';

describe('toLLM · 金额币种', () => {
  it('amount 字段使用 ₱（项目币种 PHP），不是 ¥', () => {
    const dto = {
      couponId: 'c1',
      couponName: 'Big Spender',
      couponType: 1,
      discountValue: '200.00',
      minPurchase: '1000.00',
      totalQuantity: 10000,
      issuedQuantity: 1,
      progress: '1',
      canClaim: true,
      hasReachedLimit: false,
    };

    const result = toLLM(dto, ClaimableCouponResponseDto, 'en');

    expect(result['Discount Value']).toBe('₱200.00');
    expect(result['Min Purchase']).toBe('₱1000.00');
  });
});
