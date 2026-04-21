import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private readonly from: string;
  private readonly frontendUrl: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.from =
      this.config.get<string>('EMAIL_FROM') ??
      'JoyMini Admin <noreply@joyminis.com>';
    this.frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'https://admin.joyminis.com';

    if (apiKey && apiKey !== 'disabled') {
      this.resend = new Resend(apiKey);
      this.logger.log('Email service initialized (Resend)');
    } else {
      this.logger.warn('RESEND_API_KEY not set — email sending is disabled');
    }
  }

  /** 申请提交确认邮件 */
  async sendApplicationReceived(to: string, realName: string) {
    await this.send({
      to,
      subject: '[JoyMini Admin] Application Received — Pending Review',
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h2 style="color:#4f46e5">Application Received </h2>
          <p>Hi <strong>${realName}</strong>,</p>
          <p>We've received your application to join <strong>JoyMini Admin</strong>.</p>
          <p>Your request is currently <strong>pending review</strong> by a super administrator.
             You'll receive an email once it's approved or rejected.</p>
          <p style="color:#6b7280;font-size:13px;margin-top:32px">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `,
    });
  }

  /** 审批通过邮件 */
  async sendApplicationApproved(
    to: string,
    realName: string,
    username: string,
  ) {
    const loginUrl = `${this.frontendUrl}/login`;
    await this.send({
      to,
      subject: '[JoyMini Admin] Application Approved — Welcome!',
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h2 style="color:#16a34a">Application Approved 🎉</h2>
          <p>Hi <strong>${realName}</strong>,</p>
          <p>Great news! Your application to join <strong>JoyMini Admin</strong> has been <strong>approved</strong>.</p>
          <table style="border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:6px 12px;background:#f3f4f6;font-weight:600">Username</td>
                <td style="padding:6px 12px">${username}</td></tr>
            <tr><td style="padding:6px 12px;background:#f3f4f6;font-weight:600">Default Role</td>
                <td style="padding:6px 12px">Viewer (read-only)</td></tr>
          </table>
          <p>You can now log in with the username and password you set during registration:</p>
          <a href="${loginUrl}" style="display:inline-block;padding:10px 20px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
            Sign In →
          </a>
          <p style="margin-top:16px;font-size:13px;color:#6b7280">
            Your role is currently <em>Viewer</em>. Contact the administrator if you need additional permissions.
          </p>
          <p style="color:#6b7280;font-size:13px;margin-top:32px">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `,
    });
  }

  /** 审批拒绝邮件 */
  async sendApplicationRejected(
    to: string,
    realName: string,
    reviewNote?: string,
  ) {
    await this.send({
      to,
      subject: '[JoyMini Admin] Application Update',
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h2 style="color:#dc2626">Application Not Approved</h2>
          <p>Hi <strong>${realName}</strong>,</p>
          <p>Unfortunately, your application to join <strong>JoyMini Admin</strong> was <strong>not approved</strong> at this time.</p>
          ${reviewNote ? `<p><strong>Reason:</strong> ${reviewNote}</p>` : ''}
          <p>If you believe this is a mistake, please contact your administrator directly.</p>
          <p style="color:#6b7280;font-size:13px;margin-top:32px">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `,
    });
  }

  /** 客户端邮箱验证码登录邮件 */
  async sendClientLoginCode(to: string, code: string, ttlSeconds: number) {
    const ttlMinutes = Math.max(1, Math.ceil(ttlSeconds / 60));
    await this.send({
      to,
      subject: '[JoyMini] Your Login Verification Code',
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h2 style="color:#2563eb">Login Verification Code</h2>
          <p>Use the following code to sign in:</p>
          <div style="font-size:28px;letter-spacing:4px;font-weight:700;margin:16px 0;color:#111827">
            ${code}
          </div>
          <p>This code expires in <strong>${ttlMinutes} minute(s)</strong>.</p>
          <p style="color:#dc2626">Never share this code with anyone.</p>
          <p style="color:#6b7280;font-size:13px;margin-top:32px">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `,
    });
  }

  private async send(opts: { to: string; subject: string; html: string }) {
    if (!this.resend) {
      this.logger.debug(
        `[Email SKIP] To: ${opts.to} | Subject: ${opts.subject}`,
      );
      return;
    }
    try {
      const { error } = await this.resend.emails.send({
        from: this.from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      });
      if (error) {
        this.logger.error(`Email send failed: ${JSON.stringify(error)}`);
      } else {
        this.logger.log(`Email sent to ${opts.to} — ${opts.subject}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Email service error: ${message}`);
    }
  }
}
