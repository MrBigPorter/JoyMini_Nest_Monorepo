'use client';

import React, { useEffect, useState } from 'react';
import { serviceHealthApi } from '@/api';
import { useTranslation } from '@/hooks/useTranslation';

interface ServiceInfo {
  name: string;
  available: boolean;
  label: string;
  description: string;
}

export function ServiceStatusBar() {
  const { t } = useTranslation();
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const res = await serviceHealthApi.check();
        if (mounted) {
          setServices(res.services ?? []);
        }
      } catch {
        // 静默失败，不阻塞页面
      } finally {
        if (mounted) setLoading(false);
      }
    };
    check();
    // 每 30 秒刷新一次
    const interval = setInterval(check, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-2 text-xs border-b border-gray-100 dark:border-white/10">
      <span className="font-medium text-gray-500">
        {t('knowledgeBase.services')}:
      </span>
      {loading ? (
        <span className="text-gray-400">检查中...</span>
      ) : services.length === 0 ? (
        <span className="text-gray-400">无法获取服务状态</span>
      ) : (
        services.map((svc) => (
          <div
            key={svc.name}
            className="flex items-center gap-1.5"
            title={`${svc.description}${!svc.available ? ' — 未启动' : ''}`}
          >
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                svc.available
                  ? 'bg-green-500'
                  : 'bg-red-400'
              }`}
            />
            <span
              className={
                svc.available
                  ? 'text-gray-700 dark:text-gray-300'
                  : 'text-gray-400'
              }
            >
              {svc.label}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
