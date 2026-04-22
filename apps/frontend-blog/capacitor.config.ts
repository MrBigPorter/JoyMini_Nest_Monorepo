import { CapacitorConfig } from '@capacitor/cli';

// 开发环境检测
const isDev = process.env.NODE_ENV === 'development';

const config: CapacitorConfig = {
  appId: 'com.tarsier.labs',
  appName: isDev ? 'Tarsier Labs Dev' : 'Tarsier Labs',
  webDir: 'out',
  server: isDev
    ? {
        // 开发环境：连接到Cloudflare Tunnel公网域名
        url: 'https://dev.joyminis.com',
        cleartext: false,
        allowNavigation: ['*'],
      }
    : {
        // 生产环境：保持现有配置
        androidScheme: 'https',
        iosScheme: 'https',
      },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DEFAULT',
      backgroundColor: '#ffffff',
    },
    Preferences: {},
    Keyboard: {
      resize: 'body',
      style: 'DARK',
      resizeOnFullScreen: true,
    },
  },
  ios: {
    scheme: 'App',
    contentInset: 'automatic',
    scrollEnabled: true,
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
