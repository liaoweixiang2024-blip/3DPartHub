import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type FormEvent,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

export function isImeComposingEvent(event: Event) {
  return Boolean((event as Event & { isComposing?: boolean }).isComposing);
}

type SearchInputProps = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  | 'value'
  | 'onChange'
  | 'onInput'
  | 'onCompositionStart'
  | 'onCompositionUpdate'
  | 'onCompositionEnd'
  | 'onKeyDown'
  | 'enterKeyHint'
  | 'autoComplete'
  | 'spellCheck'
>;

type UseImeSafeSearchInputOptions = {
  initialValue?: string;
  normalize?: (value: string) => string;
  onCommit?: (value: string) => void;
  onDraftChange?: (value: string) => void;
};

const identityNormalize = (value: string) => value;

export function useImeSafeSearchInput({
  initialValue = '',
  normalize = identityNormalize,
  onCommit,
  onDraftChange,
}: UseImeSafeSearchInputOptions = {}) {
  const normalizedInitialValue = normalize(initialValue);
  const [draftValue, setDraftValue] = useState(normalizedInitialValue);
  const [value, setCommittedValue] = useState(normalizedInitialValue);
  const committedValueRef = useRef(normalizedInitialValue);
  const composingRef = useRef(false);

  const syncDraftValue = useCallback(
    (rawValue: string) => {
      const nextValue = normalize(rawValue);
      setDraftValue(nextValue);
      onDraftChange?.(nextValue);
      return nextValue;
    },
    [normalize, onDraftChange],
  );

  const commitValue = useCallback(
    (rawValue: string) => {
      const nextValue = syncDraftValue(rawValue);
      if (nextValue !== committedValueRef.current) {
        committedValueRef.current = nextValue;
        setCommittedValue(nextValue);
        onCommit?.(nextValue);
      }
      return nextValue;
    },
    [onCommit, syncDraftValue],
  );

  const handleTextInput = useCallback(
    (rawValue: string, event: Event) => {
      if (composingRef.current || isImeComposingEvent(event)) {
        syncDraftValue(rawValue);
        return;
      }
      commitValue(rawValue);
    },
    [commitValue, syncDraftValue],
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      handleTextInput(e.target.value, e.nativeEvent);
    },
    [handleTextInput],
  );

  const handleInput = useCallback(
    (e: FormEvent<HTMLInputElement>) => {
      handleTextInput(e.currentTarget.value, e.nativeEvent);
    },
    [handleTextInput],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionUpdate = useCallback(
    (e: CompositionEvent<HTMLInputElement>) => {
      syncDraftValue(e.currentTarget.value);
    },
    [syncDraftValue],
  );

  const handleCompositionEnd = useCallback(
    (e: CompositionEvent<HTMLInputElement>) => {
      composingRef.current = false;
      commitValue(e.currentTarget.value);
    },
    [commitValue],
  );

  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && (composingRef.current || isImeComposingEvent(e.nativeEvent))) {
      e.preventDefault();
    }
  }, []);

  const setValue = useCallback(
    (nextValue: string) => {
      composingRef.current = false;
      commitValue(nextValue);
    },
    [commitValue],
  );

  const inputProps: SearchInputProps = {
    value: draftValue,
    onChange: handleChange,
    onInput: handleInput,
    onCompositionStart: handleCompositionStart,
    onCompositionUpdate: handleCompositionUpdate,
    onCompositionEnd: handleCompositionEnd,
    onKeyDown: handleKeyDown,
    enterKeyHint: 'search',
    autoComplete: 'off',
    spellCheck: false,
  };

  return { value, draftValue, setValue, inputProps };
}
