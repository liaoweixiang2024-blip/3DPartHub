import { useState, type DragEvent, type ReactNode } from 'react';

// 块级拖拽落区：包裹现有内容（不改变块内布局），拖文件悬停时整块高亮，松手回调第一个文件。
// 与 UploadModal 的拖拽行为同款；onDragLeave 用 relatedTarget 判真离开，避免子元素边界高亮闪烁。
export function FileDropArea({
  onFileDrop,
  disabled = false,
  className = '',
  children,
}: {
  onFileDrop: (file: File) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [dragActive, setDragActive] = useState(false);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // 必须：允许 drop，并阻止浏览器直接打开拖入的文件
    if (!disabled) setDragActive(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragActive(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (disabled) return;
    // 与隐藏 input 单选一致：多文件时取第一个
    const file = e.dataTransfer.files?.[0];
    if (file) onFileDrop(file);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`rounded-md outline-2 outline-offset-2 transition-colors ${
        dragActive ? 'outline-primary bg-primary-container/5' : 'outline-transparent'
      } ${className}`}
    >
      {children}
    </div>
  );
}
