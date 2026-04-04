/**
 * 客户端系统配置元数据
 * 定义客户端配置项的显示标签、描述、数据类型和默认值
 */

import { ClientConfigKey } from './client-config-whitelist';

export interface ClientConfigMetadata {
  label: string;
  description: string;
  dataType: 'string' | 'number' | 'boolean' | 'json';
  defaultValue?: string;
}

/**
 * 客户端配置项元数据映射
 */
export const CLIENT_CONFIG_METADATA: Record<
  ClientConfigKey,
  ClientConfigMetadata
> = {
  // 汇率相关
  exchange_rate_usd_php: {
    label: 'Exchange Rate (USD → PHP)',
    description: '美元兑菲律宾比索汇率，用于余额显示转换',
    dataType: 'number',
    defaultValue: '56.50',
  },
  exchange_rate_php_usd: {
    label: 'Exchange Rate (PHP → USD)',
    description: '菲律宾比索兑美元汇率，用于反向计算',
    dataType: 'number',
    defaultValue: '0.0177',
  },

  // 平台信息
  platform_name: {
    label: 'Platform Name',
    description: '平台显示名称，用于网站标题和品牌展示',
    dataType: 'string',
    defaultValue: 'Lucky Nest',
  },
  platform_email: {
    label: 'Customer Service Email',
    description: '客服邮箱地址，用于用户联系和反馈',
    dataType: 'string',
    defaultValue: 'support@luckynest.com',
  },
  web_base_url: {
    label: 'Website Base URL',
    description: '网站基础URL，用于生成完整链接和重定向',
    dataType: 'string',
    defaultValue: 'https://www.luckynest.com',
  },

  // 提现配置
  min_withdraw_amount: {
    label: 'Minimum Withdrawal Amount',
    description: '用户单次最小提现金额（菲律宾比索）',
    dataType: 'number',
    defaultValue: '500',
  },
  max_withdraw_amount: {
    label: 'Maximum Withdrawal Amount',
    description: '用户单次最大提现金额（菲律宾比索）',
    dataType: 'number',
    defaultValue: '50000',
  },
  withdraw_fee_rate: {
    label: 'Withdrawal Fee Rate',
    description: '提现手续费率，按百分比计算',
    dataType: 'number',
    defaultValue: '2.5',
  },

  // 安全与合规
  kyc_required: {
    label: 'KYC Required',
    description: 'KYC实名认证要求：1 = 必填, 0 = 可选',
    dataType: 'number',
    defaultValue: '1',
  },
  kyc_and_phone_verification: {
    label: 'KYC and Phone Verification',
    description: 'KYC和手机验证配置，JSON格式存储详细规则',
    dataType: 'json',
    defaultValue: JSON.stringify({
      requireKyc: true,
      requirePhone: true,
      verificationLevel: 'standard',
    }),
  },

  // 业务配置
  charity_rate: {
    label: 'Charity Donation Rate',
    description: '每笔交易用于慈善捐赠的比例（百分比）',
    dataType: 'number',
    defaultValue: '1.5',
  },
  robot_delay_seconds: {
    label: 'Robot Intervention Delay',
    description: '机器人介入交易处理的延迟时间（秒）',
    dataType: 'number',
    defaultValue: '10',
  },

  // 功能开关
  enable_group_chat: {
    label: 'Enable Group Chat',
    description: '是否启用群聊功能：1 = 启用, 0 = 禁用',
    dataType: 'number',
    defaultValue: '1',
  },
  enable_lucky_draw: {
    label: 'Enable Lucky Draw',
    description: '是否启用抽奖功能：1 = 启用, 0 = 禁用',
    dataType: 'number',
    defaultValue: '1',
  },
  enable_flash_sale: {
    label: 'Enable Flash Sale',
    description: '是否启用秒杀功能：1 = 启用, 0 = 禁用',
    dataType: 'number',
    defaultValue: '1',
  },
};

/**
 * 获取配置项的元数据，如果不存在则返回默认元数据
 */
export function getClientConfigMetadata(key: string): ClientConfigMetadata {
  const metadata = CLIENT_CONFIG_METADATA[key as ClientConfigKey];
  if (metadata) {
    return metadata;
  }

  // 返回默认元数据（用于不在白名单中的键）
  return {
    label: key,
    description: '',
    dataType: 'string' as const,
  };
}

/**
 * 获取所有客户端配置项的元数据
 */
export function getAllClientConfigMetadata(): Array<
  { key: ClientConfigKey } & ClientConfigMetadata
> {
  return Object.entries(CLIENT_CONFIG_METADATA).map(([key, metadata]) => ({
    key: key as ClientConfigKey,
    ...metadata,
  }));
}
