import http from './http';
import type { User } from '@/lib/stores/auth.store';

export interface LoginResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
  id: string;
  phone: string;
  phoneMd5: string;
  nickname: string;
  username: string;
  avatar: string | null;
  email: string;
  countryCode: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
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
  provider: 'google' | 'facebook' | 'apple' | 'github';
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
 * 对应后端 /v1/auth/* 端点
 */
export const authApi = {
  // ================= 邮箱验证码登录 =================

  /**
   * 发送邮箱验证码
   */
  sendEmailCode: (data: SendEmailCodeRequest) =>
    http.post('/v1/auth/email/send-code', data),

  /**
   * 邮箱验证码登录
   */
  loginWithEmailCode: (email: string, code: string) =>
    http.post<LoginResponse>('/v1/auth/email/login', {
      email,
      code,
    }),

  // ================= 手机验证码登录 =================

  /**
   * 发送手机验证码
   */
  sendOtp: (data: SendOtpRequest) => http.post('/v1/auth/login/otp', data),

  /**
   * 手机验证码登录
   */
  loginWithOtp: (phone: string, code: string) =>
    http.post<LoginResponse>('/v1/auth/login/otp', {
      phone,
      code,
    }),

  // ================= OAuth 登录 =================

  /**
   * Google OAuth 登录
   */
  loginWithGoogle: (idToken: string, inviteCode?: string) => {
    return http.post<LoginResponse>('/v1/auth/oauth/google', {
      idToken,
      credential: idToken, // 兼容两种字段
      inviteCode,
    });
  },

  /**
   * Facebook OAuth 登录
   */
  loginWithFacebook: (
    accessToken: string,
    userId: string,
    inviteCode?: string,
  ) => {
    return http.post<LoginResponse>('/v1/auth/oauth/facebook', {
      accessToken,
      userId,
      inviteCode,
    });
  },

  /**
   * Apple OAuth 登录
   */
  loginWithApple: (idToken: string, inviteCode?: string) => {
    return http.post<LoginResponse>('/v1/auth/oauth/apple', {
      idToken,
      inviteCode,
    });
  },

  /**
   * Github OAuth 登录
   */
  loginWithGithub: (code: string, inviteCode?: string) => {
    return http.post<LoginResponse>('/v1/auth/oauth/github', {
      code,
      inviteCode,
    });
  },

  // ================= Token 管理 =================

  /**
   * 刷新 Token
   */
  refreshToken: (refreshToken: string) =>
    http.post<RefreshTokenResponse>('/v1/auth/refresh', {
      refreshToken,
    }),

  /**
   * 登出
   */
  logout: () => http.post('/v1/auth/logout'),

  // ================= 用户信息 =================

  /**
   * 获取用户信息
   */
  getProfile: () => http.get<User>('/v1/auth/profile'),

  /**
   * 更新用户信息
   */
  updateProfile: (data: Partial<User>) =>
    http.put<User>('/v1/auth/profile', data),

  // ================= 注册相关 =================

  /**
   * 注册用户
   */
  register: (data: {
    email: string;
    code: string;
    password: string;
    nickname: string;
  }) => http.post<LoginResponse>('/v1/auth/register', data),

  /**
   * 检查邮箱是否已注册
   */
  checkEmailExists: (email: string) =>
    http.post<{ exists: boolean }>('/v1/auth/check-email', { email }),

  // ================= 密码重置 =================

  /**
   * 发送密码重置邮件
   */
  sendPasswordResetEmail: (email: string) =>
    http.post('/v1/auth/send-password-reset-email', { email }),

  /**
   * 重置密码
   */
  resetPassword: (data: { token: string; newPassword: string }) =>
    http.post('/v1/auth/reset-password', data),

  // ================= 验证相关 =================

  /**
   * 验证邮箱
   */
  verifyEmail: (token: string) => http.post('/v1/auth/verify-email', { token }),

  /**
   * 重新发送验证邮件
   */
  resendVerificationEmail: (email: string) =>
    http.post('/v1/auth/resend-verification-email', { email }),
};

export default authApi;
