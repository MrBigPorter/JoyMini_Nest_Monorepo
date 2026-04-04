'use client';

import { Zap, X } from 'lucide-react';

const QUICK_REPLIES = [
  'Thank you for contacting support! How can I help you today?',
  'I understand your concern. Let me look into this for you.',
  'Your issue has been resolved. Please let us know if you need further assistance.',
  'Could you please provide more details about the problem?',
  'We apologize for the inconvenience. Our team is working on it.',
  'Your account has been updated successfully.',
  'Please allow 1-3 business days for the transaction to process.',
];

export function QuickRepliesPanel({
  onSelect,
  onClose,
}: {
  onSelect: (text: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-xl shadow-lg overflow-hidden z-10">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-white/10">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <Zap size={11} className="text-yellow-500" />
          Quick Replies
        </span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <X size={13} />
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {QUICK_REPLIES.map((text, i) => (
          <button
            key={i}
            onClick={() => {
              onSelect(text);
              onClose();
            }}
            className="w-full text-left text-sm px-3 py-2 hover:bg-teal-50 dark:hover:bg-teal-500/10 text-gray-700 dark:text-gray-300 border-b border-gray-50 dark:border-white/5 last:border-0 transition-colors truncate"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
