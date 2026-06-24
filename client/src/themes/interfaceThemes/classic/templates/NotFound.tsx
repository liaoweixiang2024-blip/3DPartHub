import type { NotFoundThemeProps } from '../../types';

export default function ClassicNotFound({ brand, title, description, homeLink }: NotFoundThemeProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
      <div className="mb-2">{brand}</div>
      {title}
      {description}
      {homeLink}
    </div>
  );
}
