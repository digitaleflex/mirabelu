import type { ReactNode } from 'react';

export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack" style={{ gap: 8 }} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} style={{ height: 14, width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

export function BookTileSkeleton() {
  return (
    <div className="tile" aria-hidden="true">
      <Skeleton style={{ aspectRatio: '1', width: '100%', borderRadius: 16 }} />
      <Skeleton style={{ height: 14, width: '80%' }} />
      <Skeleton style={{ height: 12, width: '50%' }} />
    </div>
  );
}

export function BookRowSkeleton() {
  return (
    <li className="row" aria-hidden="true">
      <Skeleton style={{ width: 64, height: 64, borderRadius: 12 }} />
      <div style={{ display: 'grid', gap: 8 }}>
        <Skeleton style={{ height: 16, width: '70%' }} />
        <Skeleton style={{ height: 12, width: '40%' }} />
      </div>
    </li>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge-new">{children}</span>;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action, icon = '📖' }: { title: string; children?: ReactNode; action?: { href: string; label: string }; icon?: string }) {
  return (
    <div className="empty">
      <div className="empty-illust" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action && <a className="btn primary" href={action.href}>{action.label}</a>}
    </div>
  );
}
