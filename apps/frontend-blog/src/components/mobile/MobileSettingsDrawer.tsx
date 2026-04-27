'use client';

import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

interface MobileSettingsDrawerProps {
  isOpen: boolean;
  onCloseAction: () => void;
  title?: string;
  children: React.ReactNode;
  enableClickOutsideClose?: boolean;
  className?: string;
  showClose?: boolean;
}

export function MobileSettingsDrawer({
  isOpen,
  onCloseAction,
  title,
  children,
  enableClickOutsideClose = true,
  className,
  showClose = true,
}: MobileSettingsDrawerProps) {
  // 阻止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // 处理ESC键关闭
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onCloseAction();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onCloseAction]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
            onClick={enableClickOutsideClose ? onCloseAction : undefined}
          />

          {/* 抽屉内容 */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{
              type: 'spring',
              damping: 25,
              stiffness: 300,
              mass: 0.8,
            }}
            className={cn(
              'fixed bottom-0 left-0 right-0 z-[101]',
              'bg-background rounded-t-2xl shadow-2xl border-t border-border',
              'max-h-[85vh] flex flex-col',
              className,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 拖动指示器 */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-12 h-1.5 bg-border rounded-full" />
            </div>

            {/* 标题栏 */}
            {(title || showClose) && (
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                {title && (
                  <h2 className="text-lg font-semibold text-foreground">
                    {title}
                  </h2>
                )}
                {showClose && (
                  <button
                    onClick={onCloseAction}
                    className="p-2 -mr-2 rounded-full hover:bg-accent transition-colors"
                    aria-label="关闭设置"
                  >
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                )}
              </div>
            )}

            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4">
              {children}
            </div>

            {/* 安全区域占位 */}
            <div style={{ height: 'var(--safe-area-bottom)' }} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
