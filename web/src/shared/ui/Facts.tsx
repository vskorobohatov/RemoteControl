import type { ReactNode } from "react";
import { classnames } from "./controls";
import styles from "./Facts.module.scss";

export interface Fact {
  label: string;
  value: ReactNode;
}

interface FactsProps {
  items: readonly Fact[];
  minWidth?: number;
  className?: string;
}

export function Facts({ items, minWidth = 150, className }: FactsProps) {
  return (
    <dl
      className={classnames(styles.facts, className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))` }}
    >
      {items.map((item) => (
        <div key={item.label} className={styles.item}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
