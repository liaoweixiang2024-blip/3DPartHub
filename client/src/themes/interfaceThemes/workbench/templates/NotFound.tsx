import type { NotFoundThemeProps } from '../../types';

export default function WorkbenchNotFound({ brand, title, description, homeLink }: NotFoundThemeProps) {
  return (
    <div className="grid min-h-dvh place-items-center bg-surface px-5">
      <section className="w-full max-w-xl rounded-2xl border border-outline-variant/15 bg-surface-container-low px-6 py-8 text-center shadow-xl md:px-10 md:py-10">
        <div className="mx-auto mb-5 flex justify-center">{brand}</div>
        {title}
        {description}
        <div className="mt-7">{homeLink}</div>
      </section>
    </div>
  );
}
