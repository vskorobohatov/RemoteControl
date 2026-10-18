import type { HTMLAttributes } from "react";
import { classnames } from "./controls";
import styles from "./Actions.module.scss";

interface ActionsProps extends HTMLAttributes<HTMLDivElement> {
  direction?: "row" | "stack";
}

export function Actions({ direction = "row", className, children, ...rest }: ActionsProps) {
  return (
    <div
      className={classnames(
        styles.actions,
        direction === "stack" ? styles.stack : styles.row,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "block" | "inline";
}

export function EmptyState({ variant = "block", className, children, ...rest }: EmptyStateProps) {
  if (variant === "inline") {
    return (
      <p className={classnames(styles.inline, className)} {...rest}>
        {children}
      </p>
    );
  }
  return (
    <div className={classnames(styles.empty, className)} {...rest}>
      {children}
    </div>
  );
}
