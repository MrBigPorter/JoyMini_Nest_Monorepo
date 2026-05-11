/**
 * OAuth工具函数
 * 处理第三方登录相关功能
 */

import { authApi } from '@/lib/api/authApi';

/**
 * 处理Google OAuth登录
 * @param credential Google ID Token
 * @returns 登录结果
 */
export async function handleGoogleLogin(credential: string) {
  try {
    const response = await authApi.loginWithGoogle(credential);

    return {
      success: true,
      data: response,
    };
  } catch (error: any) {
    console.error('Google OAuth login failed:', error);
    return {
      success: false,
      error: error.message || 'Google登录失败',
    };
  }
}

/**
 * 处理Github OAuth登录
 * @param code Github OAuth授权码
 * @returns 登录结果
 */
export async function handleGithubLogin(code: string) {
  try {
    const response = await authApi.loginWithGithub(code);

    return {
      success: true,
      data: response,
    };
  } catch (error: any) {
    console.error('Github OAuth login failed:', error);
    return {
      success: false,
      error: error.message || 'Github登录失败',
    };
  }
}

/**
 * 处理Facebook OAuth登录
 * @param accessToken Facebook Access Token
 * @param userId Facebook User ID
 * @returns 登录结果
 */
export async function handleFacebookLogin(accessToken: string, userId: string) {
  try {
    const response = await authApi.loginWithFacebook(accessToken, userId);

    return {
      success: true,
      data: response,
    };
  } catch (error: any) {
    console.error('Facebook OAuth login failed:', error);
    return {
      success: false,
      error: error.message || 'Facebook登录失败',
    };
  }
}

/**
 * 初始化Facebook SDK
 * 需要在页面加载时调用
 */
export function initFacebookSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }

    const facebookAppId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
    if (!facebookAppId) {
      console.warn(
        'Facebook App ID is not configured. Facebook login will not work.',
      );
      resolve();
      return;
    }

    // 检查是否已经加载了Facebook SDK
    if (window.FB) {
      resolve();
      return;
    }

    // 加载Facebook SDK
    window.fbAsyncInit = function () {
      window.FB.init({
        appId: facebookAppId,
        cookie: true,
        xfbml: true,
        version: 'v18.0',
      });
      resolve();
    };

    // 加载SDK脚本
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => reject(new Error('Failed to load Facebook SDK'));
    document.body.appendChild(script);
  });
}

/**
 * 触发Facebook登录
 * @returns Promise包含access token或错误
 */
export function triggerFacebookLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.FB) {
      reject(new Error('Facebook SDK not loaded'));
      return;
    }

    window.FB.login(
      (response: any) => {
        if (response.authResponse) {
          resolve(response.authResponse.accessToken);
        } else {
          reject(new Error('User cancelled login or did not fully authorize'));
        }
      },
      { scope: 'email,public_profile' },
    );
  });
}

// 扩展Window接口以支持Facebook SDK
declare global {
  interface Window {
    FB: any;
    fbAsyncInit: () => void;
  }
}
