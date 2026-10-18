import { classnames, type ClassMap, type Tone } from "@shared/ui/controls";
import styles from "./CoreBars.module.scss";

const TONE_CLASS: ClassMap<Tone> = {
  ok: styles.ok,
  warn: styles.warn,
  danger: styles.danger,
  external: styles.external,
  primary: styles.primary,
  accent: styles.accent,
};

function toneFor(value: number): Tone {
  if (value >= 90) return "danger";
  if (value >= 60) return "warn";
  return "ok";
}

export function CoreBars({ values }: { values: number[] }) {
  return (
    <div className={styles.bars} role="img" aria-label="per-core utilisation">
      {values.map((value, index) => (
        <div className={styles.slot} key={index}>
          <div
            className={classnames(styles.bar, TONE_CLASS[toneFor(value)])}
            style={{ height: `${Math.max(2, Math.min(100, value))}%` }}
          />
        </div>
      ))}
    </div>
  );
}
