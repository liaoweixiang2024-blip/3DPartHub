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
