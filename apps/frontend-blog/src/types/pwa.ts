/**
 * PWA相关类型定义
 */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface ServiceWorkerRegistrationWithUpdate extends ServiceWorkerRegistration {
  waiting: ServiceWorker | null;
  installing: ServiceWorker | null;
}

export interface PWAInstallPrompt {
  event: BeforeInstallPromptEvent;
  showPrompt: () => Promise<void>;
  isInstallable: boolean;
}

export interface PWAState {
  isInstallable: boolean;
  isInstalled: boolean;
  isOffline: boolean;
  isUpdateAvailable: boolean;
  deferredPrompt: BeforeInstallPromptEvent | null;
}

export interface PWAActions {
  showInstallPrompt: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  skipWaiting: () => Promise<void>;
  clearDeferredPrompt: () => void;
}

export type UsePWAReturn = PWAState & PWAActions;
