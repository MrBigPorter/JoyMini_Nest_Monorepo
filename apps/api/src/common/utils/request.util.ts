import { Request } from 'express';

/**
 * 获取真实客户端 IP (
 */
export function getRealIp(req: Request): string {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (Array.isArray(ip)) ip = ip[0];
  else if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0];
  const cleanIp = (ip as string)?.trim() || '';
  return cleanIp.substring(0, 50);
}

/**
 * 获取 User-Agent
 */
export function getUserAgent(req: Request): string {
  const ua = req.headers['user-agent'];
  if (Array.isArray(ua)) {
    return ua[0] || '';
  }
  if (typeof ua === 'string') {
    return ua;
  }
  return '';
}

/**
 *  获取设备 ID
 */
export function getDeviceId(req: Request): string {
  const headers = req.headers;
  // 兼容多种写法，优先取 x-device-id
  return (
    (headers['x-device-id'] as string) ||
    (headers['device-id'] as string) ||
    'unknown'
  );
}

/**
 *  获取设备型号
 */
export function getDeviceModel(req: Request): string {
  const headers = req.headers;
  return (
    (headers['x-device-model'] as string) ||
    (headers['device-model'] as string) ||
    'unknown'
  );
}
