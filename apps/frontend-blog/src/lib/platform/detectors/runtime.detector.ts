/**
 * 运行时环境检测器
 * 基于现有的env.ts扩展，支持平台检测
 */

import { detectEnvironment, isClient } from '@/lib/env';
import type { PlatformType, RuntimeEnvironment, DeviceInfo } from '../types';

/** 缓存检测结果 */
let cachedPlatform: PlatformType | null = null;
let cachedDeviceInfo: DeviceInfo | null = null;

/**
 * 检测当前平台类型
 */
export function detectPlatform(): PlatformType {
  if (cachedPlatform) return cachedPlatform;
  
  // 1. 检查是否在浏览器环境
  if (typeof window === 'undefined') {
    cachedPlatform = 'server';
    return cachedPlatform;
  }
  
  // 2. 检查是否是Capacitor App
  if (isCapacitorApp()) {
    cachedPlatform = 'capacitor';
    return cachedPlatform;
  }
  
  // 3. 检查是否是H5（移动端浏览器）
  if (isMobileBrowser()) {
    cachedPlatform = 'h5';
    return cachedPlatform;
  }
  
  // 4. 默认是Web平台
  cachedPlatform = 'web';
  return cachedPlatform;
}

/**
 * 检查是否是Capacitor App
 */
function isCapacitorApp(): boolean {
  if (!isClient()) return false;
  
  // 方法1: 检查Capacitor全局对象
  if (typeof window !== 'undefined') {
    // @ts-ignore
    if (window.Capacitor || window.capacitor) {
      return true;
    }
    
    // 方法2: 检查Capacitor特定API
    // @ts-ignore
    if (typeof window.Capacitor !== 'undefined') {
      return true;
    }
    
    // 方法3: 检查用户代理
    const userAgent = window.navigator.userAgent.toLowerCase();
    if (userAgent.includes('capacitor') || userAgent.includes('cordova')) {
      return true;
    }
    
    // 方法4: 检查SyncManager（Capacitor特有）
    // @ts-ignore
    if (typeof window.SyncManager !== 'undefined') {
      return true;
    }
  }
  
  return false;
}

/**
 * 检查是否是移动端浏览器
 */
function isMobileBrowser(): boolean {
  if (!isClient()) return false;
  
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isMobile = /mobile|android|iphone|ipad|ipod|windows phone/i.test(userAgent);
  const isTablet = /tablet|ipad/i.test(userAgent) && !/mobile/i.test(userAgent);
  
  return isMobile || isTablet;
}

/**
 * 获取设备信息
 */
export function getDeviceInfo(): DeviceInfo {
  if (cachedDeviceInfo) return cachedDeviceInfo;
  
  const platform = detectPlatform();
  const isClientEnv = isClient();
  
  let isMobile = false;
  let isTablet = false;
  let isDesktop = false;
  let os = 'unknown';
  let browser = 'unknown';
  let screenSize = { width: 0, height: 0 };
  
  if (isClientEnv) {
    // 屏幕尺寸
    screenSize = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    
    // 设备类型
    const userAgent = window.navigator.userAgent.toLowerCase();
    isMobile = /mobile|android|iphone|ipad|ipod|windows phone/i.test(userAgent);
    isTablet = /tablet|ipad/i.test(userAgent) && !/mobile/i.test(userAgent);
    isDesktop = !isMobile && !isTablet;
    
    // 操作系统
    if (/windows/i.test(userAgent)) os = 'windows';
    else if (/mac os|macintosh/i.test(userAgent)) os = 'macos';
    else if (/linux/i.test(userAgent)) os = 'linux';
    else if (/android/i.test(userAgent)) os = 'android';
    else if (/iphone|ipad|ipod/i.test(userAgent)) os = 'ios';
    
    // 浏览器
    if (/chrome/i.test(userAgent) && !/edge/i.test(userAgent)) browser = 'chrome';
    else if (/firefox/i.test(userAgent)) browser = 'firefox';
    else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) browser = 'safari';
    else if (/edge/i.test(userAgent)) browser = 'edge';
    else if (/opera|opr/i.test(userAgent)) browser = 'opera';
  }
  
  cachedDeviceInfo = {
    platform,
    isMobile,
    isTablet,
    isDesktop,
    os,
    browser,
    screenSize,
  };
  
  return cachedDeviceInfo;
}

/**
 * 获取完整的运行时信息
 */
export function getRuntimeInfo() {
  const environment = detectEnvironment();
  const platform = detectPlatform();
  const deviceInfo = getDeviceInfo();
  
  return {
    environment,
    platform,
    deviceInfo,
    timestamp: Date.now(),
    userAgent: isClient() ? window.navigator.userAgent : 'server',
  };
}

/**
 * 检查是否支持特定功能
 */
export function supportsFeature(feature: string): boolean {
  const platform = detectPlatform();
  const isClientEnv = isClient();
  
  switch (feature) {
    case 'server-actions':
      // Server Actions仅支持Web平台
      return platform === 'web';
      
    case 'persistent-cache':
      // 持久化缓存支持所有客户端平台
      return isClientEnv;
      
    case 'push-notifications':
      // 推送通知支持Capacitor和现代浏览器
      return platform === 'capacitor' || 
             (platform === 'web' && 'Notification' in window && 'serviceWorker' in navigator);
      
    case 'camera':
      // 相机支持Capacitor和现代浏览器
      return platform === 'capacitor' || 
             (platform === 'web' && 'mediaDevices' in navigator);
      
    case 'geolocation':
      // 地理位置支持所有客户端平台
      return isClientEnv && 'geolocation' in navigator;
      
    case 'background-sync':
      // 后台同步仅支持支持Service Worker的浏览器
      return platform === 'web' && 'serviceWorker' in navigator && 'SyncManager' in window;
      
    default:
      return false;
  }
}

/**
 * 重置缓存（用于测试）
 */
export function resetCache(): void {
  cachedPlatform = null;
  cachedDeviceInfo = null;
}

// ================= 导出 =================

// 注意：这里不需要重复导出，因为函数已经在顶部声明为export
