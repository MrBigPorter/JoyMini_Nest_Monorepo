'use client';

import React, { useRef, useState, useEffect } from 'react';
import {
  X,
  Loader2,
  Check,
  Calendar,
  UploadCloud,
  Image as ImageIcon,
  GripVertical,
  Download,
  ChevronDown,
  Info,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence, Variants } from 'framer-motion';

// --- Animation Variants ---
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

// --- Helper: CSV Export ---
const exportToCSV = (data: Record<string, unknown>[], filename: string) => {
  if (!data || !data.length) return;

  // Extract headers
  const headers = Object.keys(data[0]);
  const csvRows = [];

  // Add headers
  csvRows.push(headers.join(','));

  // Add data
  for (const row of data) {
    const values = headers.map((header) => {
      const escaped = ('' + row[header]).replace(/"/g, '\\"');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(','));
  }

  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.setAttribute('hidden', '');
  a.setAttribute('href', url);
  a.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

// --- Breadcrumbs ---
export const Breadcrumbs: React.FC<{ items: string[] }> = ({ items }) => (
  <nav className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-1">
    {items.map((item, index) => (
      <React.Fragment key={index}>
        {index > 0 && <ChevronRight size={14} className="mx-2" />}
        <span
          className={
            index === items.length - 1
              ? 'font-semibold text-gray-900 dark:text-white'
              : ''
          }
        >
          {item}
        </span>
      </React.Fragment>
    ))}
  </nav>
);

// --- Card ---
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  title?: string;
  action?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  title,
  action,
  ...props
}) => (
  <div
    className={`bg-white dark:bg-dark-800 rounded-xl shadow-sm border border-gray-100 dark:border-white/5 p-6 transition-colors duration-300 ${className}`}
    {...props}
  >
    <div className="flex justify-between items-center mb-6">
      {title && (
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">
          {title}
        </h3>
      )}
      {action && <div>{action}</div>}
    </div>
    {children}
  </div>
);

// --- Button ---
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
    'rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed';

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  };

  const variants = {
    primary:
      'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/30 border border-transparent',
    secondary:
      'bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200 border border-transparent',
    danger:
      'bg-red-500 text-white shadow-lg shadow-red-500/30 border border-transparent',
    ghost: 'text-gray-500 dark:text-gray-400 bg-transparent',
    outline:
      'bg-transparent border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200',
  };

  return (
    <motion.button
      whileHover={{ scale: 1.02, filter: 'brightness(1.1)' }}
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

// --- Export Button ---
export const ExportButton: React.FC<{
  data?: Record<string, unknown>[];
  filename?: string;
  onClick?: () => void;
}> = ({ data, filename = 'export', onClick }) => {
  const handleExport = () => {
    if (onClick) {
      onClick();
    } else if (data) {
      exportToCSV(data, filename);
    } else {
      alert('No data to export');
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport}>
      <Download size={14} /> Export CSV
    </Button>
  );
};

// --- Input ---
export const Input: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & {
    label?: string;
    error?: string;
  }
> = ({ label, error, className = '', ...props }) => (
  <div className="w-full">
    {label && (
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
      </label>
    )}
    {/* border/ring 放在 wrapper，:-webkit-autofill 只作用于 <input>，永远影响不到这里的边框 */}
    <div
      className={`flex items-center bg-gray-50 dark:bg-black/20 border ${error ? 'border-red-500' : 'border-gray-200 dark:border-white/10'} rounded-lg focus-within:ring-2 focus-within:ring-primary-500/50 focus-within:border-primary-500 transition-all`}
    >
      <input
        className={`w-full px-4 py-2.5 bg-transparent border-0 outline-none text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 ${className}`}
        {...props}
      />
    </div>
    {error && <span className="block text-xs text-red-500 mt-1">{error}</span>}
  </div>
);

// --- Textarea ---
export const Textarea: React.FC<
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }
> = ({ label, className = '', ...props }) => (
  <div className="w-full">
    {label && (
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
      </label>
    )}
    <textarea
      className={`w-full px-4 py-2.5 bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 outline-none transition-all dark:text-white placeholder-gray-400 dark:placeholder-gray-600 min-h-[100px] resize-none ${className}`}
      {...props}
    />
  </div>
);

// --- Select ---
interface SelectOption {
  label: string;
  value: string | number;
}
export const Select: React.FC<
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    label?: string;
    options: SelectOption[];
  }
> = ({ label, options, className = '', ...props }) => (
  <div className="w-full">
    {label && (
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
      </label>
    )}
    <div className="relative">
      <select
        className={`w-full appearance-none px-4 py-2.5 bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 outline-none transition-all dark:text-white ${className}`}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
        <ChevronDown size={14} />
      </div>
    </div>
  </div>
);

// --- Switch ---
export const Switch: React.FC<{
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}> = ({ label, checked, onChange, disabled = false }) => (
  <div className="flex items-center justify-between">
    {label && (
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
    )}
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${checked ? 'bg-primary-500' : 'bg-gray-200 dark:bg-gray-700'}`}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 700, damping: 30 }}
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  </div>
);

// --- Badge ---
export type BadgeColor =
  | 'green'
  | 'blue'
  | 'yellow'
  | 'red'
  | 'purple'
  | 'gray';
export const Badge: React.FC<{
  children: React.ReactNode;
  color?: BadgeColor;
}> = ({ children, color = 'blue' }) => {
  const colors = {
    green:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20',
    yellow:
      'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20',
    red: 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400 border border-red-200 dark:border-red-500/20',
    purple:
      'bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20',
    gray: 'bg-gray-100 text-gray-700 dark:bg-gray-500/10 dark:text-gray-400 border border-gray-200 dark:border-gray-500/20',
  };
  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${colors[color]}`}
    >
      {children}
    </span>
  );
};

// --- Modal ---
export const Modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}> = ({ isOpen, onClose, title, children, size = 'md' }) => {
  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              onClick={(e) => e.stopPropagation()}
              className={`bg-white dark:bg-dark-900 w-full ${sizes[size]} rounded-2xl shadow-2xl border border-white/10 overflow-hidden flex flex-col max-h-[90vh]`}
            >
              <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-white/5">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                  {title}
                </h3>
                <button
                  onClick={onClose}
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
        </>
      )}
    </AnimatePresence>
  );
};

// --- DateRangePicker (Mock) ---
export const DateRangePicker: React.FC = () => {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="flex items-center bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer hover:border-primary-500/50 transition-colors"
    >
      <Calendar size={16} className="text-gray-400" />
      <span>Mar 1 - Mar 20, 2024</span>
    </motion.div>
  );
};

// --- ImageUpload ---
export const ImageUpload: React.FC<{
  label?: string;
  value: string;
  onChange: (val: string) => void;
}> = ({ label, value, onChange }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    setUploading(true);
    setTimeout(() => {
      const fakeUrl = URL.createObjectURL(file);
      onChange(fakeUrl);
      setUploading(false);
    }, 1500);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
          {label}
        </label>
      )}
      <motion.div
        whileHover={{ borderColor: 'var(--primary-500)' }}
        className={`relative border-2 border-dashed rounded-xl p-4 transition-all flex flex-col items-center justify-center text-center cursor-pointer min-h-[160px] 
          ${isDragging ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/10' : 'border-gray-300 dark:border-white/10'}
          ${value ? 'bg-gray-50 dark:bg-black/20' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />

        {uploading ? (
          <div className="flex flex-col items-center text-primary-500">
            <Loader2 className="w-8 h-8 animate-spin mb-2" />
            <span className="text-sm">Uploading...</span>
          </div>
        ) : value ? (
          <div className="relative w-full h-full group">
            {/* eslint-disable-next-line @next/next/no-img-element -- uploader preview: src is a blob URL, dimensions unknown */}
            <img
              src={value}
              alt="Uploaded"
              className="h-32 w-full object-contain rounded-lg"
            />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
              <span className="text-white text-sm flex items-center gap-2">
                <UploadCloud size={16} /> Change Image
              </span>
            </div>
          </div>
        ) : (
          <div className="text-gray-400 dark:text-gray-500">
            <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-3">
              <ImageIcon size={24} />
            </div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Click or drag image here
            </p>
            <p className="text-xs mt-1">SVG, PNG, JPG or GIF (max. 5MB)</p>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export const DragHandle: React.FC<{ className?: string }> = ({
  className = '',
}) => (
  <div
    className={`cursor-grab active:cursor-grabbing p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ${className}`}
  >
    <GripVertical size={16} />
  </div>
);

// --- Dropdown ---
export const Dropdown: React.FC<{
  trigger: React.ReactNode;
  items: {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
  }[];
}> = ({ trigger, items }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen(!open)} className="cursor-pointer">
        {trigger}
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-48 bg-white dark:bg-dark-800 rounded-xl shadow-xl border border-gray-100 dark:border-white/5 py-1 z-50"
          >
            {items.map((item, idx) => (
              <button
                key={idx}
                onClick={() => {
                  item.onClick();
                  setOpen(false);
                }}
                className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors ${item.danger ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5'}`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Toast System ---
export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export const Toast: React.FC<{
  toast: ToastMessage;
  onClose: (id: string) => void;
}> = ({ toast, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => onClose(toast.id), 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onClose]);

  const icons = {
    success: <Check className="text-green-500" size={20} />,
    error: <X className="text-red-500" size={20} />,
    info: <Info className="text-blue-500" size={20} />,
  };

  const borders = {
    success: 'border-l-green-500',
    error: 'border-l-red-500',
    info: 'border-l-blue-500',
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 50, transition: { duration: 0.2 } }}
      layout
      className={`flex items-center gap-3 min-w-[300px] bg-white dark:bg-dark-800 p-4 rounded-lg shadow-xl border border-gray-100 dark:border-white/10 border-l-4 ${borders[toast.type]}`}
    >
      {icons[toast.type]}
      <p className="text-sm font-medium text-gray-800 dark:text-white flex-1">
        {toast.message}
      </p>
      <button
        onClick={() => onClose(toast.id)}
        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
      >
        <X size={16} />
      </button>
    </motion.div>
  );
};

export const ToastContainer: React.FC<{
  toasts: ToastMessage[];
  removeToast: (id: string) => void;
}> = ({ toasts, removeToast }) => {
  return (
    <div className="fixed top-20 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
      <div className="pointer-events-auto flex flex-col gap-3">
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <Toast key={t.id} toast={t} onClose={removeToast} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
