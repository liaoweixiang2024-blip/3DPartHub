import type { NotFoundThemeProps } from '../../types';

export default function WorkbenchNotFound({ brand, title, description, homeLink }: NotFoundThemeProps) {
  return (
    <div className="grid flex-1 place-items-center bg-surface px-5">
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto mb-5 flex justify-center">{brand}</div>
        {title}
        {description}
        <div className="mt-7">{homeLink}</div>
      </div>
    </div>
  );
}
