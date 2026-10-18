import type { ReactNode } from "react";
import { classnames } from "@shared/ui/controls";
import styles from "./PageLayout.module.scss";

interface PageGridProps {
  single?: boolean;
  children: ReactNode;
}

export function PageGrid({ single = false, children }: PageGridProps) {
  return <main className={classnames(styles.grid, single && styles.single)}>{children}</main>;
}

interface PageColumnProps {
  title?: string;
  counters?: ReactNode;
  variant?: "primary" | "side";
  children: ReactNode;
}

export function PageColumn({ title, counters, variant = "primary", children }: PageColumnProps) {
  const Section = variant === "side" ? "aside" : "section";

  return (
    <Section className={classnames(styles.column, variant === "side" && styles.side)}>
      {title !== undefined || counters !== undefined ? (
        <div className={styles.head}>
          {title !== undefined ? <h2 className={styles.title}>{title}</h2> : null}
          {counters ? <div className={styles.counters}>{counters}</div> : null}
        </div>
      ) : null}
      {children}
    </Section>
  );
}
