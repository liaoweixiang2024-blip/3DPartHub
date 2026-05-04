import { useEffect, useState } from 'react';

/**
 * Unified model thumbnail component with a geometric SVG placeholder
 * when no actual thumbnail is available or the image fails to load.
 */

interface ModelThumbnailProps {
  src?: string | null;
  alt?: string;
  className?: string;
  /** Extra className applied to the placeholder wrapper */
  placeholderClassName?: string;
}

/** Inline SVG — isometric 3D wireframe cube with subtle gradient */
function PlaceholderSVG() {
  return (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Background gradient */}
      <defs>
        <linearGradient id="pg-bg" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.03" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="pg-stroke" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill="url(#pg-bg)" />

      {/* Isometric cube — top face */}
      <path d="M50 22L76 36V56L50 70L24 56V36L50 22Z" stroke="url(#pg-stroke)" strokeWidth="1.2" fill="none" />
      {/* Bottom-left edge to ground */}
      <path d="M24 56L24 72" stroke="url(#pg-stroke)" strokeWidth="1" strokeDasharray="3 3" />
      <path d="M76 56L76 72" stroke="url(#pg-stroke)" strokeWidth="1" strokeDasharray="3 3" />
      <path d="M50 70L50 86" stroke="url(#pg-stroke)" strokeWidth="1" strokeDasharray="3 3" />
      {/* Ground shadow */}
      <ellipse cx="50" cy="88" rx="30" ry="4" fill="currentColor" fillOpacity="0.04" />

      {/* Small vertex dots */}
      <circle cx="50" cy="22" r="1.5" fill="currentColor" fillOpacity="0.2" />
      <circle cx="24" cy="56" r="1.5" fill="currentColor" fillOpacity="0.15" />
      <circle cx="76" cy="56" r="1.5" fill="currentColor" fillOpacity="0.15" />
      <circle cx="50" cy="70" r="1.5" fill="currentColor" fillOpacity="0.15" />
    </svg>
  );
}

export default function ModelThumbnail({ src, alt, className, placeholderClassName }: ModelThumbnailProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return <img src={src} alt={alt || ''} className={className} loading="lazy" onError={() => setFailed(true)} />;
  }

  return (
    <div className={`text-on-surface-variant ${placeholderClassName || className || ''}`}>
      <PlaceholderSVG />
    </div>
  );
}
