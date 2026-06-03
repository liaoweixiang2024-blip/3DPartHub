import type { FormHTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './Icon';

interface SearchFieldProps {
  formProps?: FormHTMLAttributes<HTMLFormElement>;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
  inputRef?: Ref<HTMLInputElement>;
  value?: string;
  onClear?: () => void;
  placeholder: string;
  className?: string;
  inputClassName?: string;
  clearAriaLabel?: string;
  iconSize?: number;
}

export const SEARCH_FIELD_CLASS =
  'app-search-field flex h-9 w-full min-w-0 items-center overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container px-3';

export const SEARCH_INPUT_CLASS =
  'h-full min-w-0 flex-1 appearance-none border-none bg-transparent p-0 text-sm leading-none text-on-surface outline-none placeholder:text-on-surface-variant/50';

export default function SearchField({
  formProps,
  inputProps,
  inputRef,
  value,
  onClear,
  placeholder,
  className = '',
  inputClassName = '',
  clearAriaLabel,
  iconSize = 16,
}: SearchFieldProps) {
  const { t } = useTranslation();
  const visibleValue = value ?? (typeof inputProps?.value === 'string' ? inputProps.value : '');
  const visibleClearAriaLabel = clearAriaLabel ?? t('topNav.clearSearch');
  const { className: formClassName = '', ...restFormProps } = formProps || {};
  const content: ReactNode = (
    <>
      <Icon name="search" size={iconSize} className="mr-2 shrink-0 text-on-surface-variant" />
      <input
        ref={inputRef}
        type="text"
        {...inputProps}
        placeholder={placeholder}
        className={`${SEARCH_INPUT_CLASS} ${inputClassName}`}
      />
      {visibleValue && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 p-0.5 text-on-surface-variant hover:text-on-surface"
          aria-label={visibleClearAriaLabel}
          data-tooltip-ignore
        >
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </>
  );

  if (formProps) {
    return (
      <form {...restFormProps} className={`${SEARCH_FIELD_CLASS} ${formClassName} ${className}`}>
        {content}
      </form>
    );
  }

  return <div className={`${SEARCH_FIELD_CLASS} ${className}`}>{content}</div>;
}
