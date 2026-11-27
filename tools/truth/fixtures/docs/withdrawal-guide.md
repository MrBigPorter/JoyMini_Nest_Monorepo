# Withdrawal Guide

## Withdrawal Methods

| Method | Processing Time | Min Amount | Max Amount | Fee |
|:-------|:---------------:|:----------:|:----------:|:---:|
| **GCash** | Varies by channel | ₱100 | ₱50,000 | 1% + ₱5 <!-- truth: PH_GCASH_WITHDRAW.available --> <!-- truth: PH_GCASH_WITHDRAW.fee --> <!-- truth: PH_GCASH_WITHDRAW.min --> <!-- truth: PH_GCASH_WITHDRAW.max --> |
| **Bank Transfer (InstaPay)** | Varies by channel | ₱200 | ₱100,000 | 1% + ₱10 <!-- truth: PH_BANK_WITHDRAW.available --> <!-- truth: PH_BANK_WITHDRAW.fee --> <!-- truth: PH_BANK_WITHDRAW.min --> <!-- truth: PH_BANK_WITHDRAW.max --> |

## How to Withdraw

### Step 1 — Request Withdrawal

1. Go to **Wallet → Withdraw**.
2. Select your payout method (GCash or Bank Transfer).
3. Enter the amount to withdraw.
4. Review the fee and estimated arrival time.

### Step 2 — OTP Verification

1. An **OTP** will be sent to your registered mobile number.
2. Enter the OTP in the app.
3. **OTP is valid for 5 minutes.**
4. If you don't receive the OTP, wait 60 seconds and request again.

### Step 3 — Confirmation

1. Once verified, the withdrawal request is submitted.
2. You will receive a confirmation notification.
3. The withdrawal status will show as "Processing."
4. Check transaction history in **Wallet → Transactions**.

## Withdrawal Limits

| Account Level | Per Transaction | Daily | Monthly |
|:--------------|:---------------:|:-----:|:-------:|
| KYC Level 0 | ₱5,000 | ₱10,000 | ₱50,000 |
| KYC Level 1 | ₱25,000 | ₱50,000 | ₱250,000 |
| KYC Level 2 | ₱50,000 | ₱100,000 | ₱500,000 |
| KYC Level 3 | ₱100,000 | ₱500,000 | ₱2,000,000 |

Higher withdrawal limits require a higher KYC level. See [KYC Guide](../kyc/kyc-guide.en.md).

## Withdrawal Requirements

### GCash Withdrawal
- GCash account must be **verified** (Level 2).
- GCash number must match your JoyMini registered number.

### Bank Transfer
- Bank account name must match your JoyMini KYC name.
- The receiving bank must be selectable in the app when you submit the withdrawal request.

## Common Withdrawal Issues

| Issue | Cause | Solution |
|:------|:------|:---------|
| "Insufficient balance" | Withdrawal amount exceeds available balance | Reduce withdrawal amount |
| "OTP not received" | Network delay or wrong number | Wait 60s and retry, or check registered number |
| "Exceeded daily limit" | Daily withdrawal cap reached | Wait until the next day |
| "Account name mismatch" | Bank account name ≠ KYC name | Update bank info or contact support |
| "Withdrawal failed" | Bank/GCash system error | Retry after 30 minutes, or contact support |

See [Wallet Troubleshooting](wallet-troubleshooting.en.md) for detailed solutions.

## Important Notes

- Withdrawals can only be made to accounts in **your own name**.
- JoyMini **never** processes third-party withdrawals.
- Withdrawals are processed **24/7** including weekends and holidays.
- For suspicious activity, contact support immediately.
