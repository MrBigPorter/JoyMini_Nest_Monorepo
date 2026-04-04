/**
 * OAuth错误处理类
 * 提供标准化的错误分类和用户友好提示
 */

export class OAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly provider?: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export class OAuthStateError extends OAuthError {
  constructor(message: string, provider?: string) {
    super(message, 'INVALID_STATE', provider);
  }
}

export class OAuthProviderError extends OAuthError {
  constructor(message: string, provider: string) {
    super(message, 'PROVIDER_ERROR', provider);
  }
}

export class OAuthNetworkError extends OAuthError {
  constructor(message: string, provider?: string) {
    super(message, 'NETWORK_ERROR', provider);
  }
}

export class OAuthUserCancelledError extends OAuthError {
  constructor(provider?: string) {
    super('User cancelled OAuth flow', 'USER_CANCELLED', provider);
  }
}

export class OAuthInvalidCallbackError extends OAuthError {
  constructor(message: string, provider?: string) {
    super(message, 'INVALID_CALLBACK', provider);
  }
}

export class OAuthTokenExpiredError extends OAuthError {
  constructor(provider?: string) {
    super('OAuth token has expired', 'TOKEN_EXPIRED', provider);
  }
}

/**
 * 错误代码映射到用户友好消息
 */
export const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_STATE: 'Login session has expired, please log in again',
  PROVIDER_ERROR:
    'Third-party login service is temporarily unavailable, please try again later',
  NETWORK_ERROR: 'Network connection failed, please check network settings',
  USER_CANCELLED: 'Login cancelled',
  INVALID_CALLBACK: 'Callback URL is invalid',
  TOKEN_EXPIRED: 'Login credentials have expired, please log in again',
  DEFAULT: 'An error occurred during login, please try again later',
};

/**
 * 获取用户友好的错误消息
 */
export function getUserFriendlyErrorMessage(error: OAuthError | Error): string {
  if (error instanceof OAuthError) {
    return OAUTH_ERROR_MESSAGES[error.code] || OAUTH_ERROR_MESSAGES.DEFAULT;
  }
  return OAUTH_ERROR_MESSAGES.DEFAULT;
}
