interface SparklineProps {
  values: number[];
  ceiling?: number;
  tone?: string;
}

export function Sparkline({ values, ceiling, tone = "signal" }: SparklineProps) {
  const shape = "spark";
  if (values.length < 2) {
    return (
      <svg className={`${shape} ${shape}--${tone}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline className={`${shape}-flat`} points="0,99 100,99" vectorEffect="non-scaling-stroke" />
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
    <svg className={`${shape} ${shape}--${tone}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polygon className={`${shape}-area`} points={area} />
      <polyline className={`${shape}-line`} points={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface BarRowProps {
  values: number[];
}

export function CoreBars({ values }: BarRowProps) {
  return (
    <div className="cores" role="img" aria-label="per-core utilisation">
      {values.map((value, index) => (
        <div className="cores-slot" key={index}>
          <div
            className={`cores-bar cores-bar--${toneFor(value)}`}
            style={{ height: `${Math.max(2, Math.min(100, value))}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function toneFor(value: number): string {
  if (value >= 90) {
    return "hot";
  }
  if (value >= 60) {
    return "warm";
  }
  return "cool";
}

interface GaugeProps {
  label: string;
  used: number | null;
  total: number | null;
  format: (value: number) => string;
}

export function Gauge({ label, used, total, format }: GaugeProps) {
  const ratio = used !== null && total !== null && total > 0 ? Math.max(0, Math.min(1, used / total)) : 0;
  const percent = Math.round(ratio * 100);

  return (
    <div className="gauge">
      <div className="gauge-head">
        <span className="gauge-label">{label}</span>
        <span className="gauge-value">
          {used === null ? "—" : format(used)} / {total === null ? "—" : format(total)}
        </span>
      </div>
      <div className="gauge-track">
        <div className={`gauge-fill gauge-fill--${percent >= 90 ? "hot" : percent >= 70 ? "warm" : "cool"}`} style={{ width: `${percent}%` }} />
      </div>
      <div className="gauge-percent">{percent}%</div>
    </div>
  );
}
