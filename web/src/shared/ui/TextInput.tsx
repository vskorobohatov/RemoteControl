import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { classnames, type ClassMap, type ControlSize } from "./controls";
import field from "./Field.module.scss";

const SIZES: ClassMap<ControlSize> = {
  sm: field.sm,
  md: field.md,
  lg: field.lg,
};

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  size?: ControlSize;
}

export type TextInputProps = FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

export function TextInput({ label, hint, error, size = "md", className, ...rest }: TextInputProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      <input
        className={classnames(field.control, SIZES[size], className)}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Field>
  );
}

export function PasswordInput({ label, hint, error, size = "md", className, ...rest }: TextInputProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <Field label={label} hint={hint} error={error}>
      <div className={field.secret}>
        <input
          type={revealed ? "text" : "password"}
          className={classnames(field.control, SIZES[size], className)}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
        <button
          type="button"
          className={field.reveal}
          aria-pressed={revealed}
          onClick={() => setRevealed((value) => !value)}
        >
          {revealed ? "hide" : "show"}
        </button>
      </div>
    </Field>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: FieldProps & { children: ReactNode }) {
  return (
    <label className={field.field}>
      <span className={field.label}>{label}</span>
      {children}
      {error ? <span className={field.error}>{error}</span> : null}
      {!error && hint ? <span className={field.hint}>{hint}</span> : null}
    </label>
  );
}

