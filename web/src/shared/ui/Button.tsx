import type { ButtonHTMLAttributes, ReactNode } from "react";
import { classnames, type ClassMap, type ControlSize } from "./controls";
import styles from "./Button.module.scss";

export type ButtonVariant = "primary" | "secondary" | "success" | "danger" | "icon";

const VARIANTS: ClassMap<ButtonVariant> = {
  primary: styles.primary,
  secondary: styles.secondary,
  success: styles.success,
  danger: styles.danger,
  icon: styles.icon,
};

const SIZES: ClassMap<ControlSize> = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ControlSize;
  block?: boolean;
  loading?: boolean;
  active?: boolean;
  glyph?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  block = false,
  loading = false,
  active = false,
  glyph,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={classnames(
        styles.base,
        VARIANTS[variant],
        SIZES[size],
        active && styles.active,
        block && styles.block,
        className,
      )}
      {...rest}
    >
      {glyph !== undefined ? <span className={styles.glyph}>{glyph}</span> : null}
      {loading ? (children ? "…" : null) : children}
    </button>
  );
}
