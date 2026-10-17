import type { MetricsSnapshot } from "../types.js";

export interface HistoryQuery {
  fromMs: number;
  toMs: number;
  maxPoints: number;
}

export class MetricsStore {
  private points: MetricsSnapshot[] = [];

  constructor(private readonly maxAgeMs: number) {}

  push(snapshot: MetricsSnapshot): void {
    this.points.push(snapshot);
    this.prune(snapshot.t);
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - this.maxAgeMs;
    let drop = 0;
    while (drop < this.points.length && (this.points[drop]!.t < cutoff || this.points.length > 200_000)) {
      drop += 1;
    }
    if (drop > 0) {
      this.points.splice(0, drop);
    }
  }

  latest(): MetricsSnapshot | null {
    return this.points.at(-1) ?? null;
  }

  count(): number {
    return this.points.length;
  }

  history(query: HistoryQuery): MetricsSnapshot[] {
    const { fromMs, toMs, maxPoints } = query;
    const inRange = this.points.filter((point) => point.t >= fromMs && point.t <= toMs);
    if (inRange.length <= maxPoints || maxPoints < 2) {
      return inRange;
    }

    const bucketSize = (toMs - fromMs) / maxPoints;
    const decimated: MetricsSnapshot[] = [];
    let bucketIndex = 0;
    let lastOfBucket: MetricsSnapshot | null = null;

    for (const point of inRange) {
      const index = Math.min(maxPoints - 1, Math.floor((point.t - fromMs) / bucketSize));
      if (index !== bucketIndex) {
        if (lastOfBucket !== null) {
          decimated.push(lastOfBucket);
        }
        bucketIndex = index;
        lastOfBucket = point;
      } else {
        lastOfBucket = lastOfBucket === null ? point : peakOf(lastOfBucket, point);
      }
    }
    if (lastOfBucket !== null) {
      decimated.push(lastOfBucket);
    }

    return decimated;
  }
}

/** Keeps the busiest sample of a bucket so short spikes survive decimation. */
function peakOf(a: MetricsSnapshot, b: MetricsSnapshot): MetricsSnapshot {
  return b.cpu.totalPercent >= a.cpu.totalPercent ? b : a;
}
