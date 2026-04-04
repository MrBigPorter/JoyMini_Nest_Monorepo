'use client';

import React, { useState } from 'react';
import { useRequest } from 'ahooks';
import { Button, cn } from '@repo/ui';
import {
  User,
  Video,
  X,
  Maximize2,
  CheckCircle2,
  XCircle,
  ScanText,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import { KYC_STATUS, KYC_STATUS_LABEL, TimeHelper } from '@lucky/shared';
import { useToastStore } from '@/store/useToastStore';
import { KycRecord } from '@/type/types';
import { kycApi } from '@/api';
import { Image } from '@unpic/react';

interface Props {
  data: KycRecord;
  close: () => void;
  reload: () => void;
}

// --- 组件：大图预览 (Lightbox) ---
const ImagePreviewModal = ({
  src,
  title,
  onClose,
}: {
  src: string;
  title: string;
  onClose: () => void;
}) => {
  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors"
      >
        <X size={32} />
      </button>
      <div
        className="max-w-full max-h-full flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- KYC lightbox: image dimensions are unknown at runtime */}
        <img
          src={src}
          alt={title}
          className="max-w-[90vw] max-h-[85vh] object-contain rounded shadow-2xl"
        />
        <p className="text-white/90 mt-3 text-lg font-medium">{title}</p>
      </div>
    </div>
  );
};

// --- 组件：精致的证据卡片 ---
const EvidenceCard = ({
  title,
  src,
  onPreview,
}: {
  title: string;
  src?: string;
  onPreview: (src: string, title: string) => void;
}) => (
  <div className="group relative bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all">
    {/* Header */}
    <div className="px-3 py-2 border-b border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-white/5 flex justify-between items-center">
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
        {title}
      </span>
      {src && (
        <Maximize2
          size={14}
          className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
        />
      )}
    </div>

    {/* Image Area */}
    <div className="relative aspect-video bg-gray-100 dark:bg-black/20">
      {src ? (
        <div
          className="w-full h-full cursor-zoom-in"
          onClick={() => onPreview(src, title)}
        >
          <Image
            src={src}
            alt={title}
            width={600}
            height={400}
            layout="constrained"
            className="w-full h-full object-contain"
          />
          {/* Hover Overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 gap-1">
          <ScanText size={24} className="opacity-20" />
          <span className="text-[10px]">No Image</span>
        </div>
      )}
    </div>
  </div>
);

// --- 组件：数据对比行 ---
const InfoRow = ({
  label,
  value,
  subValue,
  highlight = false,
}: {
  label: string;
  value: React.ReactNode;
  subValue?: string;
  highlight?: boolean;
}) => (
  <div className="py-3 border-b border-gray-100 dark:border-white/5 last:border-0">
    <div className="flex justify-between items-center mb-1">
      <span className="text-xs text-gray-500">{label}</span>
      {subValue && (
        <span
          className={cn(
            'text-[10px] font-mono px-1.5 py-0.5 rounded border',
            value !== subValue
              ? 'bg-amber-50 text-amber-700 border-amber-100'
              : 'bg-green-50 text-green-700 border-green-100',
          )}
        >
          OCR: {subValue}
        </span>
      )}
    </div>
    <div
      className={cn(
        'text-sm break-all',
        highlight
          ? 'font-bold text-gray-900 dark:text-white'
          : 'text-gray-700 dark:text-gray-300',
      )}
    >
      {value || '-'}
    </div>
  </div>
);

export const KycAuditModal: React.FC<Props> = ({ data, close, reload }) => {
  const [remark, setRemark] = useState('');
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    title: string;
  } | null>(null);
  const addToast = useToastStore((state) => state.addToast);

  const isReviewing = data.kycStatus === KYC_STATUS.REVIEWING;
  const ocrData = data.ocrRawData || {};

  const { run: submitAudit, loading } = useRequest(kycApi.audit, {
    manual: true,
    onSuccess: () => {
      addToast('success', 'Audit processed successfully');
      reload();
      close();
    },
    onError: (err) => {
      addToast('error', err.message || 'Audit failed');
    },
  });

  const handleAudit = (action: 'APPROVE' | 'REJECT' | 'NEED_MORE') => {
    if (!remark && action !== 'APPROVE') {
      return addToast('error', 'Remark is required for this action.');
    }
    submitAudit(data.id, { action, remark });
  };

  return (
    <>
      {/* 主容器：填满弹窗高度，左右布局 */}
      <div className="flex flex-col lg:flex-row h-full w-full overflow-hidden bg-white dark:bg-gray-900">
        {/* --- LEFT: Evidence Area (Scrollable) --- */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-black/20 custom-scrollbar border-r border-gray-200 dark:border-white/5">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <ScanText size={16} className="text-primary-600" /> Identity
            Documents
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <EvidenceCard
              title="ID Card Front"
              src={data.idCardFront}
              onPreview={(s, t) => setPreviewImage({ src: s, title: t })}
            />
            <EvidenceCard
              title="ID Card Back"
              src={data.idCardBack}
              onPreview={(s, t) => setPreviewImage({ src: s, title: t })}
            />
          </div>

          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Video size={16} className="text-primary-600" /> Biometric
            Verification
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4">
            <EvidenceCard
              title="Selfie Photo"
              src={data.faceImage}
              onPreview={(s, t) => setPreviewImage({ src: s, title: t })}
            />

            <div className="group relative bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden shadow-sm">
              <div className="px-3 py-2 border-b border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-white/5 flex justify-between items-center">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                  Liveness Video
                </span>
                {data.livenessScore !== undefined && (
                  <span
                    className={cn(
                      'text-[10px] px-1.5 rounded font-bold',
                      data.livenessScore > 90
                        ? 'bg-green-100 text-green-700'
                        : 'bg-amber-100 text-amber-700',
                    )}
                  >
                    Score: {data.livenessScore.toFixed(0)}
                  </span>
                )}
              </div>
              <div className="relative aspect-video bg-black flex items-center justify-center">
                {data.videoUrl ? (
                  <video
                    src={data.videoUrl}
                    controls
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center text-gray-500 gap-1">
                    <Video size={24} className="opacity-30" />
                    <span className="text-[10px]">No Video</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* --- RIGHT: Sidebar (Info + Fixed Footer) --- */}
        {/* 关键修改：flex-col 并且包含了 Footer */}
        <div className="w-full lg:w-96 flex flex-col h-full bg-white dark:bg-gray-900 shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)] z-10 relative">
          {/* 1. Scrollable Data List (占据剩余空间) */}
          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
            <div className="flex items-center gap-2 mb-4">
              <User size={16} className="text-primary-600" />
              <h3 className="font-bold text-gray-800 dark:text-white text-sm">
                Applicant Data
              </h3>
            </div>

            <div className="space-y-1">
              <InfoRow
                label="Submitted Name"
                value={data.realName}
                subValue={ocrData.name}
                highlight
              />
              <InfoRow
                label="ID Number"
                value={
                  <code className="font-mono text-primary-700">
                    {data.idNumber}
                  </code>
                }
                subValue={ocrData.idNumber}
                highlight
              />
              <InfoRow
                label="Birthday"
                value={TimeHelper.formatDate(data.birthday)}
                subValue={TimeHelper.formatDate(ocrData.birthday)}
              />
              <InfoRow label="User ID" value={data.userId} />
              <InfoRow label="Phone" value={data.user?.phone} />
              <InfoRow
                label="Submission Time"
                value={TimeHelper.formatDateTime(data.submittedAt)}
              />
            </div>

            {ocrData.idNumber && data.idNumber !== ocrData.idNumber && (
              <div className="mt-6 p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-xs flex gap-2">
                <AlertTriangle size={16} className="shrink-0" />
                <div>
                  <strong>Risk Alert:</strong> ID Number mismatch.
                </div>
              </div>
            )}
          </div>

          {/* 2. Sticky Footer (固定在右下角) */}
          <div className="flex-none p-5 border-t border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-gray-800/50">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={14} className="text-gray-400" />
              <span className="text-xs font-bold text-gray-500 uppercase">
                Decision
              </span>
            </div>

            <textarea
              className={cn(
                'w-full h-20 border rounded-lg p-3 text-sm outline-none resize-none transition-all mb-4',
                'bg-white dark:bg-black/20 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500',
                'border-gray-200 dark:border-white/20',
                !isReviewing && 'opacity-60 bg-gray-50 cursor-not-allowed',
              )}
              disabled={!isReviewing}
              placeholder={
                isReviewing
                  ? 'Remarks (Required for Reject/More Info)...'
                  : 'Auditor remarks...'
              }
              value={
                isReviewing
                  ? remark
                  : data.auditResult || data.rejectReason || ''
              }
              onChange={(e) => setRemark(e.target.value)}
            />

            {isReviewing ? (
              <div className="grid grid-cols-4 gap-3">
                <Button
                  variant="danger"
                  className="col-span-1"
                  size="sm"
                  isLoading={loading}
                  disabled={!remark}
                  onClick={() => handleAudit('REJECT')}
                  title="Reject"
                >
                  <XCircle size={18} />
                </Button>
                <Button
                  variant="outline"
                  className="col-span-1 border-amber-300 text-amber-600 hover:bg-amber-50"
                  size="sm"
                  isLoading={loading}
                  disabled={!remark}
                  onClick={() => handleAudit('NEED_MORE')}
                  title="Request Info"
                >
                  ?
                </Button>
                <Button
                  variant="primary"
                  className="col-span-2 shadow-sm"
                  size="sm"
                  isLoading={loading}
                  onClick={() => handleAudit('APPROVE')}
                >
                  <CheckCircle2 size={16} className="mr-2" /> Approve
                </Button>
              </div>
            ) : (
              <div
                className={cn(
                  'flex items-center justify-center gap-2 p-3 rounded-lg font-bold border text-sm',
                  data.kycStatus === KYC_STATUS.APPROVED
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : 'bg-red-50 text-red-700 border-red-200',
                )}
              >
                {data.kycStatus === KYC_STATUS.APPROVED ? (
                  <CheckCircle2 size={18} />
                ) : (
                  <XCircle size={18} />
                )}
                <span>Current Status: {KYC_STATUS_LABEL[data.kycStatus]}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {previewImage && (
        <ImagePreviewModal
          src={previewImage.src}
          title={previewImage.title}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </>
  );
};
