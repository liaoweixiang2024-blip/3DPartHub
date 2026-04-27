import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import useSWR from "swr";
import { converterApi, type ConversionResponse } from "../../api";
import client from "../../api/client";
import { categoriesApi } from "../../api/categories";
import { useAuthStore } from "../../stores";
import { getBusinessConfig } from "../../lib/businessConfig";
import Icon from "../shared/Icon";
import CategorySelect from "./CategorySelect";

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onConverted?: (result: ConversionResponse) => void;
}

export default function UploadModal({ open, onClose, onConverted }: UploadModalProps) {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConversionResponse | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadPolicy } = getBusinessConfig();
  const acceptedFormats = uploadPolicy.modelFormats.map((f) => `.${f}`).join(",");
  const chunkSize = Math.max(1, uploadPolicy.chunkSizeMb) * 1024 * 1024;
  const chunkThreshold = Math.max(1, uploadPolicy.chunkThresholdMb) * 1024 * 1024;
  const maxSize = Math.max(1, uploadPolicy.modelMaxSizeMb) * 1024 * 1024;

  const { data: categoryData } = useSWR(open ? "/categories" : null, () => categoriesApi.tree());

  const reset = useCallback(() => {
    setProgress(0);
    setError(null);
    setResult(null);
    setUploading(false);
    setCategoryId("");
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const uploadChunked = useCallback(async (file: File) => {
    const totalChunks = Math.ceil(file.size / chunkSize);

    // Init
    const { data: initResp } = await client.post("/upload/init", {
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
    });
    const { uploadId } = initResp?.data || initResp;

    // Upload chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);

      await client.put(`/upload/chunk?uploadId=${uploadId}&chunkIndex=${i}`, chunk, {
        headers: { "Content-Type": "application/octet-stream" },
      });

      setProgress(5 + Math.round(((i + 1) / totalChunks) * 60));
    }

    // Complete
    const { data: completeResp } = await client.post("/upload/complete", { uploadId });
    return completeResp?.data || completeResp;
  }, [chunkSize]);

  const handleFile = useCallback(async (file: File) => {
    if (!isAuthenticated) {
      setError("请先登录后再上传模型");
      setTimeout(() => { handleClose(); navigate("/login"); }, 1500);
      return;
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !uploadPolicy.modelFormats.map((f) => f.toLowerCase()).includes(ext)) {
      setError(`不支持的格式，请上传 ${uploadPolicy.modelFormats.map((f) => `.${f}`).join(" / ")} 文件`);
      return;
    }

    if (file.size > maxSize) {
      setError(`文件过大，最大支持 ${uploadPolicy.modelMaxSizeMb}MB`);
      return;
    }

    setUploading(true);
    setError(null);
    setProgress(5);

    try {
      let res: ConversionResponse;

      if (file.size > chunkThreshold) {
        // Chunked upload path: upload chunks → merge on server → create from local file
        const uploadResult = await uploadChunked(file);
        setProgress(75);
        // Create model from the already-merged file on server — no re-upload
        res = await converterApi.uploadLocal(
          uploadResult.filePath,
          uploadResult.fileName || file.name,
          categoryId || undefined,
        );
      } else {
        // Standard upload
        res = await converterApi.uploadAndConvert(file, {
          categoryId: categoryId || undefined,
          onUploadProgress: (e) => {
            if (e.total) {
              const pct = Math.round((e.loaded / e.total) * 80);
              setProgress(5 + pct);
            }
          },
        });
      }

      setProgress(100);
      setResult(res);
      onConverted?.(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "上传失败";
      setError(message);
    } finally {
      setUploading(false);
    }
  }, [categoryId, isAuthenticated, onConverted, handleClose, navigate, uploadChunked, uploadPolicy, maxSize, chunkThreshold]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
          onClick={handleClose}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="bg-surface-container-low rounded-t-2xl sm:rounded-lg w-full max-w-lg shadow-2xl border border-outline-variant/20 overflow-hidden max-h-[calc(100dvh-1rem)] sm:max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-outline-variant/10 shrink-0">
              <h2 className="font-headline text-lg font-bold text-on-surface">上传模型文件</h2>
              <button onClick={handleClose} className="p-1 text-on-surface-variant hover:text-on-surface transition-colors rounded-sm">
                <Icon name="close" size={28} />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto">
              {result ? (
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                    <Icon name="check_circle" size={36} className="text-green-500" />
                  </div>
                  <div className="text-center min-w-0 max-w-full">
                    <p className="text-on-surface font-medium break-all">{result.original_name}</p>
                    <p className="text-sm text-on-surface-variant mt-1">
                      {result.status === "completed"
                        ? `已生成 GLB 预览 (${(result.gltf_size / 1024).toFixed(1)} KB)`
                        : "文件已上传，正在转换中"}
                    </p>
                  </div>
                  <button onClick={handleClose} className="mt-2 bg-primary-container text-on-primary rounded-sm px-6 py-2 text-sm font-medium hover:opacity-90">
                    完成
                  </button>
                </div>
              ) : (
                <>
                  {/* Category selector */}
                  {!uploading && categoryData?.items && categoryData.items.length > 0 && (
                    <div className="mb-4">
                      <label className="text-xs uppercase tracking-wider text-on-surface-variant mb-1.5 block">分类</label>
                      <CategorySelect
                        categories={categoryData.items}
                        value={categoryId}
                        onChange={setCategoryId}
                        placeholder="选择分类（可选）"
                      />
                    </div>
                  )}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    onClick={() => inputRef.current?.click()}
                    className={`border-2 border-dashed rounded-lg p-5 sm:p-8 text-center cursor-pointer transition-all ${
                      dragActive ? "border-primary bg-primary-container/5" : "border-outline-variant/30 hover:border-primary/50 hover:bg-surface-container/50"
                    } ${uploading ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <input ref={inputRef} type="file" accept={acceptedFormats} onChange={handleChange} className="hidden" />
                    <Icon name={uploading ? "hourglass_top" : "cloud_upload"} size={48} className="text-on-surface-variant/40 mb-3 block" />
                    {uploading ? (
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-sm text-on-surface-variant">
                          {progress < 80 ? `上传中... ${progress}%` : "正在转换中..."}
                        </p>
                        <div className="w-full max-w-xs h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                          <motion.div className="h-full bg-primary rounded-full" initial={{ width: "5%" }} animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-on-surface mb-1">拖放文件到此处，或点击选择</p>
                        <p className="text-xs text-on-surface-variant">支持 {uploadPolicy.modelFormats.map((f) => f.toUpperCase()).join(" / ")} 格式，最大 {uploadPolicy.modelMaxSizeMb}MB</p>
                      </>
                    )}
                  </div>

                  {error && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                      className="mt-4 p-3 rounded-sm bg-error/10 border border-error/20 text-sm text-error flex items-start gap-2">
                      <Icon name="error" size={20} className="mt-0.5" />
                      <span className="min-w-0 break-words">{error}</span>
                    </motion.div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
