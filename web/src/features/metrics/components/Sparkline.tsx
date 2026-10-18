import { classnames, type ClassMap } from "@shared/ui/controls";
import styles from "./Sparkline.module.scss";

const TONE_CLASS: ClassMap<"primary" | "accent"> = {
  primary: styles.primary,
  accent: styles.accent,
};

interface SparklineProps {
  values: number[];
  ceiling?: number;
  tone?: "primary" | "accent";
}

export function Sparkline({ values, ceiling, tone = "primary" }: SparklineProps) {
  const toneClass = TONE_CLASS[tone];

  if (values.length < 2) {
    return (
      <svg
        className={classnames(styles.spark, toneClass)}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline className={styles.flat} points="0,99 100,99" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }

  const top = ceiling ?? Math.max(1, ...values);
  const step = 100 / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = 100 - Math.max(0, Math.min(100, (value / top) * 100));
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const line = points.join(" ");
  const area = `0,100 ${line} 100,100`;

  return (
    <svg className={classnames(styles.spark, toneClass)} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polygon className={styles.area} points={area} />
      <polyline className={styles.line} points={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
