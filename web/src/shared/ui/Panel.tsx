import type { HTMLAttributes, ReactNode } from "react";
import { classnames } from "./controls";
import styles from "./Panel.module.scss";

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "panel" | "sheet";
}

export function Panel({ variant = "panel", className, children, ...rest }: PanelProps) {
  return (
    <div
      className={classnames(styles.panel, variant === "sheet" && styles.sheet, className)}
      {...rest}
    >
      {children}
    </div>
  );
}

interface PanelHeaderProps {
  title: string;
  meta?: ReactNode;
}

export function PanelHeader({ title, meta }: PanelHeaderProps) {
  return (
    <div className={styles.head}>
      <h2 className={styles.title}>{title}</h2>
      {meta ? <span className={styles.meta}>{meta}</span> : null}
    </div>
  );
}
