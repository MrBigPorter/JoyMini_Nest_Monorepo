---
title: Account Troubleshooting
domain: user
docId: account-troubleshooting
keywords: [account problem, login failed, otp not received, account locked, forgot password, cant login,账号问题, 登录失败, OTP未收到]
locale: en
contentType: troubleshooting
priority: P1
---

# Account Troubleshooting

## Login Issues

### "OTP not received"

| Cause | Solution |
|:------|:---------|
| Network delay | Wait **60 seconds** and request a new OTP. |
| Wrong mobile number | Check your registered number in Account → Settings. |
| SMS blocked | Ensure your phone is not blocking SMS from JoyMini. |
| Signal issue | Move to an area with better mobile signal. |
| Number ported (moved to new provider) | Contact support to update your number. |

**If OTP still not received after 3 attempts:**
1. Restart your phone.
2. Try again after 10 minutes.
3. If still failing, contact support.

### "Invalid OTP"

- OTPs expire after **5 minutes**. Request a new one.
- Check you entered the correct 6-digit code.
- Each OTP can only be used once. Don't reuse old codes.

### "Account locked"

| Reason | What Happens | Solution |
|:-------|:-------------|:---------|
| Too many failed login attempts | Account locked for 30 minutes | Wait 30 minutes and try again |
| Suspicious activity detected | Account locked until verified | Contact support to verify identity |
| Security policy violation | Account temporarily suspended | Check email for suspension notice |

### "Forgot password / PIN"

1. On the login screen, tap **Forgot Password / PIN**.
2. Enter your registered mobile number.
3. Receive OTP via SMS.
4. Create a new password / PIN.
5. Use the new credentials to log in.

## Registration Issues

### "Mobile number already registered"

- This means an account already exists with this number.
- Try **Forgot Password** to regain access to the existing account.
- If you believe this is an error, contact support.

### "OTP not sent during registration"

- Check your mobile number is correct (Philippine format: 09XX XXX XXXX).
- Ensure your phone is not in **Airplane Mode**.
- Some prepaid SIMs require load to receive SMS — ensure you have sufficient balance.

### "KYC verification required to complete registration"

- Complete KYC Level 1 to fully activate your account.
- Without KYC, you can browse but cannot purchase.
- See [KYC Guide](../kyc/kyc-guide.en.md) for instructions.

## Account Security Issues

### "Suspicious login detected"

- Change your password immediately.
- Enable **2FA (Two-Factor Authentication)** in Account → Security.
- Review active sessions in Account → Security → Active Sessions.
- Log out all other sessions if you see unfamiliar devices.

### "Account hacked / unauthorized access"

1. **Immediately** change your password in Account → Settings.
2. Go to **Security → Active Sessions** and tap **Log Out All Devices**.
3. Enable **2FA** if not already enabled.
4. Check recent orders and wallet transactions for suspicious activity.
5. Contact support to report the incident.

### "2FA code not working"

- 2FA codes refresh every **30 seconds**. Wait for a new code.
- Ensure your device's time is set to **automatic** (time sync issue can cause code mismatch).
- Use your backup codes (provided when 2FA was enabled).
- If all else fails, contact support to disable 2FA.

## Profile Update Issues

### "Can't change mobile number"

- Mobile number changes require **OTP verification** on both old and new numbers.
- If you no longer have access to the old number, contact support.
- You will need to verify your identity (provide KYC ID and selfie).

### "Name mismatch in KYC"

- Your profile name must match your government ID (for KYC).
- Request a name change by contacting support with:
  - A photo of your valid government ID
  - Explanation of the discrepancy
- Not all name changes are approved (must match legal name).

## Still Need Help?

If none of the above solutions work, contact support with:
1. Your **User ID** (found in Account → Settings).
2. A **description** of the issue and what you've tried.
3. **Screenshots** of any error messages.

See [Contact Support](../common/contact-support.en.md).
