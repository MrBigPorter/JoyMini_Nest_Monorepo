'use client';

import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { AlertTriangle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
  onConfirmAction: () => void;
  title: string;
  description: React.ReactNode;
  confirmText?: string;
  isLoading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onCloseAction,
  onConfirmAction,
  title,
  description,
  confirmText = 'Confirm',
  isLoading = false,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={title}
      size="sm"
    >
      <div className="space-y-4">
        <div className="bg-red-50 dark:bg-red-900/10 p-4 rounded-lg flex items-start gap-3 border border-red-100 dark:border-red-900/20">
          <AlertTriangle
            className="text-red-500 flex-shrink-0 mt-0.5"
            size={20}
          />
          <div className="text-sm text-red-800 dark:text-red-200">
            {description}
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onCloseAction}>
            Cancel
          </Button>

          <Button
            variant="danger"
            onClick={onConfirmAction}
            isLoading={isLoading}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
