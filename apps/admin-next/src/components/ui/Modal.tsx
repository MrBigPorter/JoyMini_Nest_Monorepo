'use client';

import React from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onCloseAction,
  title,
  children,
  size = 'md',
}) => {
  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onCloseAction}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className={`bg-white dark:bg-dark-900 w-full ${sizes[size]} rounded-2xl shadow-2xl border border-white/10 overflow-hidden flex flex-col max-h-[90vh]`}
          >
            <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-white/5">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                {title}
              </h3>
              <button
                onClick={onCloseAction}
                className="text-gray-400 hover:text-gray-500 dark:hover:text-white transition-colors p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto custom-scrollbar">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
