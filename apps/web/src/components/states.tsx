import Link from 'next/link';
import type { ApiError } from '@/lib/api';
import type { ReactNode } from 'react';

export const Loading = ({ label = 'Chargement…' }: { label?: string }) => <p role="status" className="muted">{label}</p>;

export function ErrorBox({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="notice error" role="alert">
      <p>{error.message}</p>
      {onRetry && <button className="link" onClick={onRetry}>Réessayer</button>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action && <Link className="btn primary" href={action.href}>{action.label}</Link>}
    </div>
  );
}
