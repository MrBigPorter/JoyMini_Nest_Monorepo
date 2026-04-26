import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone, type Accept } from "react-dropzone";
import { MediaUploaderContext } from "./context";
import type { MediaUploaderProps, PreviewFile } from "./types";

/** Infer MIME type from URL extension for server-returned URLs */
function getUrlMimeType(url: string): string {
  const clean = url.split("?")[0].split("#")[0]; // strip query/hash
  const ext = clean.split(".").pop()?.toLowerCase() || "";
  const videoExts = ["mp4", "webm", "mov", "avi", "mkv", "ogv", "m4v"];
  if (videoExts.includes(ext)) return "video/mp4";
  return "image/*";
}

export const MediaUploaderRoot: React.FC<MediaUploaderProps> = ({
  value,
  onUpload,
  maxFileSizeMB = 5,
  maxFileCount,
  accept,
  children,
}) => {
  const [preview, setPreview] = useState<PreviewFile[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  /** -------- 1. 初始化回显 (保持不变) -------- */
  useEffect(() => {
    if (!value) {
      setPreview([]);
      setFiles([]);
      return;
    }

    const urlList: string[] = [];
    const fileList: File[] = [];

    if (value instanceof File) {
      fileList.push(value);
    } else if (Array.isArray(value)) {
      for (const v of value) {
        if (v instanceof File) fileList.push(v);
        else if (typeof v === "string" && v) urlList.push(v);
      }
    } else if (typeof value === "string" && value) {
      urlList.push(value);
    }

    // 防止死循环：只有当本地状态为空，且有初始值时才初始化
    if (!urlList.length && !fileList.length) return;

    const fromUrl: PreviewFile[] = urlList.map((u, idx) => ({
      id: `url-${idx}`,
      name: u.split("/").pop() || `image-${idx + 1}`,
      size: 0,
      type: getUrlMimeType(u),
      preview: u,
      fromServer: true,
    }));

    const fromFile: PreviewFile[] = fileList.map((f, idx) => ({
      id: `file-${idx}`,
      name: f.name,
      size: f.size,
      type: f.type,
      preview: URL.createObjectURL(f),
      fromServer: false,
    }));

    let merged = [...fromUrl, ...fromFile];
    if (maxFileCount && maxFileCount > 0) {
      merged = merged.slice(-maxFileCount);
    }

    setPreview(merged);
    setFiles(fileList.slice(-(maxFileCount ?? fileList.length)));
  }, [value, maxFileCount, preview.length]);

  /** -------- 2. 处理 accept -------- */
  const internalAccept: Accept | undefined =
    typeof accept === "string" || !accept
      ? { "image/*": [], "video/*": [] }
      : accept;

  /** -------- 3. 拖拽 / 选择文件 (🔥 核心修复) -------- */
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (!acceptedFiles?.length) return;

      // 1. 生成预览对象
      const newPreview: PreviewFile[] = acceptedFiles.map((file, index) => ({
        id: `local-${Date.now()}-${index}`,
        name: file.name,
        size: file.size,
        type: file.type,
        preview: URL.createObjectURL(file),
        fromServer: false,
      }));

      // 2. 计算新的 preview 列表 (依赖当前的 preview 状态)
      const mergedPreview = [...preview, ...newPreview];
      const finalPreview =
        maxFileCount && maxFileCount > 0
          ? mergedPreview.slice(-maxFileCount)
          : mergedPreview;

      // 3. 计算新的 files 列表 (依赖当前的 files 状态)
      const mergedFiles = [...files, ...acceptedFiles];
      const finalFiles =
        maxFileCount && maxFileCount > 0
          ? mergedFiles.slice(-maxFileCount)
          : mergedFiles;

      // 4. 更新状态 (不再使用回调函数形式 setFiles(prev => ...))
      setPreview(finalPreview);
      setFiles(finalFiles);

      onUpload?.(finalFiles);
    },
    // 🔥 必须把 preview, files 加到依赖里
    [onUpload, maxFileCount, preview, files],
  );

  const handleRemoveFile = useCallback(
    (index: number) => {
      // 1. 计算删除后的列表
      const nextPreview = preview.filter((_, i) => i !== index);
      const nextFiles = files.filter((_, i) => i !== index);

      // 2. 更新本地状态
      setPreview(nextPreview);
      setFiles(nextFiles);

      onUpload?.(nextFiles);
    },
    [onUpload, preview, files],
  );

  const dropzone = useDropzone({
    onDrop,
    accept: internalAccept,
    maxSize: maxFileSizeMB * 1024 * 1024,
    maxFiles: maxFileCount,
    multiple: !maxFileCount || maxFileCount > 1,
  });

  const contextValue = useMemo(
    () => ({
      dropzone,
      preview,
      handleRemoveFile,
      maxFileSizeMB,
      maxFileCount,
      openFilePicker: dropzone.open,
    }),
    [dropzone, preview, handleRemoveFile, maxFileSizeMB, maxFileCount],
  );

  return (
    <MediaUploaderContext.Provider value={contextValue}>
      <div {...dropzone.getRootProps()}>
        <input {...dropzone.getInputProps()} />
        {children}
      </div>
    </MediaUploaderContext.Provider>
  );
};
