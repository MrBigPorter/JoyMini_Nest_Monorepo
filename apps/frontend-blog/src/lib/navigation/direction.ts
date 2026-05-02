'use client';

/**
 * 模块级导航方向 tracker（同步，非 React 状态）
 *
 * 必须使用模块级变量而不是 React state，因为方向信息需要在导航事件
 * 处理之前同步设置，React state 的异步更新会来不及在 AnimatePresence
 * 渲染时生效。
 *
 * 用法：
 *   // 前进（home → article）：在 Link 的 onPointerDown 中调用
 *   setNavDirection('forward');
 *
 *   // 后退（article → home）：在 router.back() 之前调用
 *   setNavDirection('backward');
 *
 *   // 浏览器后退/前进按钮：initPopStateDetection() 自动检测
 */

export type NavDirection = 'forward' | 'backward';

let _direction: NavDirection = 'forward';
let _popStateListener: (() => void) | null = null;

/** 获取当前导航方向 */
export function getNavDirection(): NavDirection {
  return _direction;
}

/** 设置当前导航方向 */
export function setNavDirection(dir: NavDirection) {
  _direction = dir;
}

/** 重置为默认方向（forward） */
export function resetNavDirection() {
  _direction = 'forward';
}

/**
 * 初始化浏览器返回/前进按钮检测
 * 在根 layout 或 provider 中调用一次即可
 */
export function initPopStateDetection() {
  if (typeof window === 'undefined') return;
  if (_popStateListener) return; // 防止重复注册

  _popStateListener = () => {
    _direction = 'backward';
  };

  window.addEventListener('popstate', _popStateListener);
}
