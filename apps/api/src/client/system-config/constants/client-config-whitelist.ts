/**
 * 客户端系统配置白名单
 * 定义客户端可以访问的配置项
 */

// 基础平台配置
export const CLIENT_CONFIG_WHITELIST = [
  // 汇率相关
  'exchange_rate_usd_php', // 汇率 USD→PHP
  'exchange_rate_php_usd', // 汇率 PHP→USD

  // 平台信息
  'platform_name', // 平台名称
  'platform_email', // 客服邮箱
  'web_base_url', // 网站基础URL

  // 提现配置
  'min_withdraw_amount', // 最小提现金额 (PHP)
  'max_withdraw_amount', // 最大提现金额 (PHP)
  'withdraw_fee_rate', // 提现手续费率 (%)

  // 安全与合规
  'kyc_required', // KYC要求 (1=必填, 0=可选)
  'kyc_and_phone_verification', // KYC和手机验证配置

  // 业务配置
  'charity_rate', // 慈善比例
  'robot_delay_seconds', // 机器人介入延迟（秒）

  // 功能开关
  'enable_group_chat', // 是否启用群聊
  'enable_lucky_draw', // 是否启用抽奖
  'enable_flash_sale', // 是否启用秒杀
] as const;

export type ClientConfigKey = (typeof CLIENT_CONFIG_WHITELIST)[number];

/**
 * 检查配置键是否在客户端白名单中
 */
export function isClientConfigKey(key: string): key is ClientConfigKey {
  return CLIENT_CONFIG_WHITELIST.includes(key as ClientConfigKey);
}
