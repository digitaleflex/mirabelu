import { timingSafeEqual } from 'node:crypto';

/** Compteurs Prometheus minimaux (sans dépendance) : requêtes par route/statut et durée cumulée. */
export class Metrics {
  private readonly counts = new Map<string, { n: number; ms: number }>();

  observe(method: string, route: string, status: number, ms: number): void {
    const key = `${method}\u0000${route}\u0000${status}`;
    const e = this.counts.get(key) ?? { n: 0, ms: 0 };
    e.n += 1;
    e.ms += ms;
    this.counts.set(key, e);
  }

  static tokenMatches(given: string, expected: string): boolean {
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  render(gauges: Record<string, number>): string {
    const lines: string[] = [
      '# TYPE mirabelu_http_requests_total counter',
      '# TYPE mirabelu_http_request_duration_ms_sum counter',
    ];
    for (const [key, { n, ms }] of this.counts) {
      const [method, route, status] = key.split('\u0000') as [string, string, string];
      const labels = `method="${method}",route="${route.replace(/["\\]/g, '')}",status="${status}"`;
      lines.push(`mirabelu_http_requests_total{${labels}} ${n}`);
      lines.push(`mirabelu_http_request_duration_ms_sum{${labels}} ${ms.toFixed(1)}`);
    }
    for (const [name, value] of Object.entries(gauges)) {
      lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
    }
    return `${lines.join('\n')}\n`;
  }
}
