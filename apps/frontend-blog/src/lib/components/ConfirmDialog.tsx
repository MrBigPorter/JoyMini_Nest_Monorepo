'use client';

import { useConfirm } from '../hooks/useConfirm';
import ClientOnly from './ClientOnly';

/**
 * 📢 Confirm 确认对话框
 *
 * 完美符合多模式架构规范:
 *  服务端永远不渲染
 *  客户端Hydrate完成后才挂载
 *  零Hydration警告
 *
 * 在根Layout中直接引入即可:
 * ```tsx
 * <ConfirmProvider>
 *   <ConfirmDialog />
 *   {children}
 * </ConfirmProvider>
 * ```
 */
export default function ConfirmDialog() {
  const { state, confirm, cancel } = useConfirm();

  if (!state.visible || !state.options) {
    return null;
  }

  const { options } = state;

  return (
    <ClientOnly fallback={null}>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={cancel}
        />

        <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
          <div className="p-6">
            {options.title && (
              <h3 className="text-xl font-semibold mb-2">{options.title}</h3>
            )}
            <p className="text-gray-600 dark:text-gray-300">
              {options.message}
            </p>
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-900/50">
            <button
              onClick={cancel}
              className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800 transition-colors"
            >
              {options.cancelText || '取消'}
            </button>
            <button
              onClick={confirm}
              className={`
                px-4 py-2 rounded-lg text-white transition-colors
                ${options.type === 'danger' ? 'bg-red-500 hover:bg-red-600' : ''}
                ${options.type === 'warning' ? 'bg-yellow-500 hover:bg-yellow-600' : ''}
                ${options.type === 'info' || !options.type ? 'bg-blue-500 hover:bg-blue-600' : ''}
              `}
            >
              {options.confirmText || '确认'}
            </button>
          </div>
        </div>
      </div>
    </ClientOnly>
  );
}

export { ConfirmDialog };
