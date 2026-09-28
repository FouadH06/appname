'use client';

import { useId } from 'react';

export interface PhoneInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  help?: string;
  error?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
}

/**
 * Phone field. Accepts any common Lebanese format (03 123 456, 70123456, +961…, 00961…) and
 * international numbers; parsing/validation is done by the caller with @app/core parsePhone.
 * Always left-to-right, also inside the Arabic UI.
 */
export function PhoneInput({
  label,
  value,
  onChange,
  placeholder,
  help,
  error,
  disabled,
  autoFocus,
  onEnter,
}: PhoneInputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-900">
        {label}
      </label>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        dir="ltr"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter?.();
        }}
        className="h-12 rounded-control border border-line-200 bg-surface-0 px-3 text-base text-ink-900 outline-none focus:border-accent-600 aria-[invalid]:border-danger-600 disabled:opacity-60"
      />
      <p
        id={hintId}
        className={error ? 'text-sm text-danger-600' : 'text-sm text-ink-500'}
        role={error ? 'alert' : undefined}
      >
        {error ?? help}
      </p>
    </div>
  );
}
