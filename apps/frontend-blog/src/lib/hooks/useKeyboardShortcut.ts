'use client';

import { useEffect, useCallback } from 'react';

interface UseKeyboardShortcutOptions {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  preventDefault?: boolean;
  enabled?: boolean;
  onTriggerAction: () => void;
}

/**
 * 键盘快捷键 Hook
 * 用于监听全局键盘快捷键，如 Cmd/Ctrl + K 打开搜索
 */
export function useKeyboardShortcut({
  key,
  ctrlKey = false,
  metaKey = false,
  shiftKey = false,
  altKey = false,
  preventDefault = true,
  enabled = true,
  onTriggerAction,
}: UseKeyboardShortcutOptions) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // 检查按键匹配
      const keyMatches = event.key.toLowerCase() === key.toLowerCase();
      const ctrlMatches = ctrlKey ? event.ctrlKey : !event.ctrlKey;
      const metaMatches = metaKey ? event.metaKey : !event.metaKey;
      const shiftMatches = shiftKey ? event.shiftKey : !event.shiftKey;
      const altMatches = altKey ? event.altKey : !event.altKey;

      // 检查是否在输入框中，避免干扰用户输入
      const target = event.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      if (
        keyMatches &&
        ctrlMatches &&
        metaMatches &&
        shiftMatches &&
        altMatches &&
        !isInput &&
        enabled
      ) {
        if (preventDefault) {
          event.preventDefault();
        }
        onTriggerAction();
      }
    },
    [
      key,
      ctrlKey,
      metaKey,
      shiftKey,
      altKey,
      preventDefault,
      enabled,
      onTriggerAction,
    ],
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown, enabled]);
}

/**
 * 搜索快捷键 Hook（Cmd/Ctrl + K）
 */
export function useSearchShortcut(onTriggerAction: () => void, enabled = true) {
  return useKeyboardShortcut({
    key: 'k',
    ctrlKey: true,
    metaKey: true,
    preventDefault: true,
    enabled,
    onTriggerAction,
  });
}

/**
 * ESC 键 Hook
 */
export function useEscapeKey(onTriggerAction: () => void, enabled = true) {
  return useKeyboardShortcut({
    key: 'Escape',
    preventDefault: true,
    enabled,
    onTriggerAction,
  });
}
