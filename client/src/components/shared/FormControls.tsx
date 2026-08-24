import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { mergeClassName } from './PagePrimitives';

export type AppFieldSize = 'sm' | 'md' | 'lg';

export const APP_FIELD_LABEL_CLASS = 'mb-1.5 block text-xs text-on-surface-variant';
export const APP_FIELD_ERROR_CLASS = 'mt-1 block text-xs text-error';
export const APP_FIELD_HELP_CLASS = 'mt-1 block text-xs text-on-surface-variant';

export const APP_FIELD_BASE_CLASS =
  'w-full border bg-surface-container-lowest text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/55 disabled:cursor-not-allowed disabled:opacity-60';

const fieldSizeClasses: Record<AppFieldSize, string> = {
  sm: 'h-8 rounded-md px-2.5 text-xs',
  md: 'h-9 rounded-lg px-3 text-sm',
  lg: 'h-10 rounded-sm px-4 text-base',
};

function fieldStateClass(error?: boolean) {
  return error ? 'border-error focus:border-error' : 'border-outline-variant/30 focus:border-primary-container';
}

interface AppFormLabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  uppercase?: boolean;
}

export function AppFormLabel({ className, uppercase = false, ...props }: AppFormLabelProps) {
  return (
    <label
      {...props}
      className={mergeClassName(
        mergeClassName(APP_FIELD_LABEL_CLASS, uppercase ? 'uppercase tracking-wider' : undefined),
        className,
      )}
    />
  );
}

/** 统一开关控件（视觉规格与设置页一致：w-11/h-6 轨道 + 白色圆钮） */
export function AppSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={disabled ? undefined : () => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${disabled ? 'cursor-not-allowed opacity-40' : ''} ${checked ? 'bg-primary-container' : 'bg-outline-variant/30'}`}
      disabled={disabled}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}

interface AppTextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  fieldSize?: AppFieldSize;
}

export const AppTextInput = forwardRef<HTMLInputElement, AppTextInputProps>(function AppTextInput(
  { className, error = false, fieldSize = 'md', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      {...props}
      className={mergeClassName(
        mergeClassName(mergeClassName(APP_FIELD_BASE_CLASS, fieldSizeClasses[fieldSize]), fieldStateClass(error)),
        className,
      )}
    />
  );
});

interface AppSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  fieldSize?: AppFieldSize;
}

export const AppSelect = forwardRef<HTMLSelectElement, AppSelectProps>(function AppSelect(
  { className, error = false, fieldSize = 'md', ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      {...props}
      className={mergeClassName(
        mergeClassName(mergeClassName(APP_FIELD_BASE_CLASS, fieldSizeClasses[fieldSize]), fieldStateClass(error)),
        className,
      )}
    />
  );
});

interface AppTextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const AppTextArea = forwardRef<HTMLTextAreaElement, AppTextAreaProps>(function AppTextArea(
  { className, error = false, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      {...props}
      className={mergeClassName(
        mergeClassName(
          'w-full rounded-lg border bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/55 disabled:cursor-not-allowed disabled:opacity-60',
          fieldStateClass(error),
        ),
        className,
      )}
    />
  );
});
