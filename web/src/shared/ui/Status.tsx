import type { HTMLAttributes, ReactNode } from "react";
import { classnames, type Tone } from "./controls";
import styles from "./Status.module.scss";

interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  children: ReactNode;
}

export function StatusPill({ tone, className, children, ...rest }: StatusPillProps) {
  return (
    <span
      className={classnames(styles.pill, tone && styles[`tone-${tone}`], className)}
      {...rest}
    >
      {children}
    </span>
  );
}

interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  children: ReactNode;
}

export function Tag({ tone, className, children, ...rest }: TagProps) {
  return (
    <span className={classnames(styles.tag, tone && styles[`tone-${tone}`], className)} {...rest}>
      {children}
    </span>
  );
}

interface CounterProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  children: ReactNode;
}

export function Counter({ tone, className, children, ...rest }: CounterProps) {
  return (
    <span className={classnames(styles.counter, tone && styles[`tone-${tone}`], className)} {...rest}>
      {children}
    </span>
  );
}
