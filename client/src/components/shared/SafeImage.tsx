import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Icon from "./Icon";

interface SafeImageProps {
  src?: string | null;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
  fallbackIcon?: string;
  loading?: "lazy" | "eager";
  onClick?: () => void;
  title?: string;
  style?: CSSProperties;
}

export default function SafeImage({
  src,
  alt = "",
  className = "",
  fallbackClassName = "",
  fallbackIcon = "image",
  loading = "lazy",
  onClick,
  title,
  style,
}: SafeImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-container-high text-on-surface-variant/35 ${className} ${fallbackClassName}`}
        onClick={onClick}
        title={title}
        style={style}
        role={onClick ? "button" : undefined}
      >
        <Icon name={fallbackIcon} size={22} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      onError={() => setFailed(true)}
      onClick={onClick}
      title={title}
      style={style}
    />
  );
}
