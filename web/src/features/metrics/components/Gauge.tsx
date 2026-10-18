import { classnames } from "@shared/ui/controls";
import styles from "./Gauge.module.scss";

interface GaugeProps {
  label: string;
  used: number | null;
  total: number | null;
  format: (value: number) => string;
}

export function Gauge({ label, used, total, format }: GaugeProps) {
  const ratio = used !== null && total !== null && total > 0 ? Math.max(0, Math.min(1, used / total)) : 0;
  const percent = Math.round(ratio * 100);
  const tone = percent >= 90 ? styles.danger : percent >= 70 ? styles.warn : styles.ok;

  return (
    <div className={styles.gauge}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>
          {used === null ? "—" : format(used)} / {total === null ? "—" : format(total)}
        </span>
      </div>
      <div className={styles.track}>
        <div className={classnames(styles.fill, tone)} style={{ width: `${percent}%` }} />
      </div>
      <div className={styles.percent}>{percent}%</div>
    </div>
  );
}
