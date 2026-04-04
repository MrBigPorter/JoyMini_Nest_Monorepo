'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading,
  className = '',
  ...props
}) => {
  const baseStyle =
    'rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all';

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  };

  const variants = {
    primary:
      'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/30 border border-transparent hover:brightness-110',
    secondary:
      'bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200 border border-transparent hover:bg-gray-200 dark:hover:bg-white/20',
    danger:
      'bg-red-500 text-white shadow-lg shadow-red-500/30 border border-transparent hover:brightness-110',
    ghost:
      'text-gray-500 dark:text-gray-400 bg-transparent hover:bg-gray-100 dark:hover:bg-white/5',
    outline:
      'bg-transparent border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5',
  };

  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      className={`${baseStyle} ${sizeStyles[size]} ${variants[variant]} ${className}`}
      disabled={isLoading}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- motion.button onDrag type conflicts with HTMLButtonElement DragEventHandler
      {...(props as any)}
    >
      {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </motion.button>
  );
};
