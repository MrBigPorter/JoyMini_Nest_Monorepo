import http from './http';
import type { User } from '@/lib/stores/auth.store';

export interface LoginResponse {
  data: {
    accessToken: string;
    refreshToken: string;
    user: User;
  };
}

export interface RefreshTokenResponse {
  data: {
    accessToken: string;
    refreshToken: string;
  };
}

export interface LoginWithEmailCodeRequest {
  email: string;
  code: string;
}

export interface LoginWithOtpRequest {
  phone: string;
  code: string;
}

export interface LoginWithOAuthRequest {
  provider: 'google' | 'facebook' | 'apple';
  token: string;
}

export interface SendEmailCodeRequest {
  email: string;
}

export interface SendOtpRequest {
  phone: string;
}

/**
 * 认证相关 API 接口
 * 对应后端 /v1/client/auth/* 端点
 */
export const authApi = {
  // ================= 邮箱验证码登录 =================

  /**
   * 发送邮箱验证码
   */
  sendEmailCode: (data: SendEmailCodeRequest) =>
    http.post('/v1/client/auth/send-email-code', data),

  /**
   * 邮箱验证码登录
   */
  loginWithEmailCode: (email: string, code: string) =>
    http.post<LoginResponse>('/v1/client/auth/login-with-email-code', {
      email,
      code,
    }),

  // ================= 手机验证码登录 =================

  /**
   * 发送手机验证码
   */
  sendOtp: (data: SendOtpRequest) =>
    http.post('/v1/client/auth/send-otp', data),

  /**
   * 手机验证码登录
   */
  loginWithOtp: (phone: string, code: string) =>
    http.post<LoginResponse>('/v1/client/auth/login-with-otp', {
      phone,
      code,
    }),

  // ================= OAuth 登录 =================

  /**
   * OAuth 登录
   */
  loginWithOAuth: (data: LoginWithOAuthRequest) =>
    http.post<LoginResponse>('/v1/client/auth/login-with-oauth', data),

  // ================= Token 管理 =================

  /**
   * 刷新 Token
   */
  refreshToken: (refreshToken: string) =>
    http.post<RefreshTokenResponse>('/v1/client/auth/refresh-token', {
      refreshToken,
    }),

  /**
   * 登出
   */
  logout: () => http.post('/v1/client/auth/logout'),

  // ================= 用户信息 =================

  /**
   * 获取用户信息
   */
  getProfile: () => http.get<User>('/v1/client/auth/profile'),

  /**
   * 更新用户信息
   */
  updateProfile: (data: Partial<User>) =>
    http.put<User>('/v1/client/auth/profile', data),

  // ================= 注册相关 =================

  /**
   * 注册用户
   */
  register: (data: {
    email: string;
    code: string;
    password: string;
    nickname: string;
  }) => http.post<LoginResponse>('/v1/client/auth/register', data),

  /**
   * 检查邮箱是否已注册
   */
  checkEmailExists: (email: string) =>
    http.post<{ exists: boolean }>('/v1/client/auth/check-email', { email }),

  // ================= 密码重置 =================

  /**
   * 发送密码重置邮件
   */
  sendPasswordResetEmail: (email: string) =>
    http.post('/v1/client/auth/send-password-reset-email', { email }),

  /**
   * 重置密码
   */
  resetPassword: (data: { token: string; newPassword: string }) =>
    http.post('/v1/client/auth/reset-password', data),

  // ================= 验证相关 =================

  /**
   * 验证邮箱
   */
  verifyEmail: (token: string) =>
    http.post('/v1/client/auth/verify-email', { token }),

  /**
   * 重新发送验证邮件
   */
  resendVerificationEmail: (email: string) =>
    http.post('/v1/client/auth/resend-verification-email', { email }),
};

export default authApi;
