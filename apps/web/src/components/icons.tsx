import type { ReactNode } from 'react';

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const I = ({ children }: { children: ReactNode }) => <svg {...base}>{children}</svg>;

export const HomeIcon = () => <I><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></I>;
export const SearchIcon = () => <I><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></I>;
export const ShelfIcon = () => <I><path d="M5 3v18" /><path d="M10 3v18" /><path d="M15 5l4 15" /></I>;
export const UserIcon = () => <I><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></I>;
export const PlayIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>;
export const PauseIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>;
export const Back15Icon = () => <I><path d="M3 12a9 9 0 109-9" /><path d="M3 4v5h5" /><text x="12" y="16" fontSize="7" textAnchor="middle" fill="currentColor" stroke="none">15</text></I>;
export const Fwd30Icon = () => <I><path d="M21 12a9 9 0 11-9-9" /><path d="M21 4v5h-5" /><text x="12" y="16" fontSize="7" textAnchor="middle" fill="currentColor" stroke="none">30</text></I>;
export const ChevronDownIcon = () => <I><path d="M6 9l6 6 6-6" /></I>;
export const HeartIcon = ({ filled }: { filled?: boolean }) => (
  <svg {...base} fill={filled ? 'currentColor' : 'none'}><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.8-8 11-8 11z" /></svg>
);
export const CloseIcon = () => <I><path d="M6 6l12 12M18 6L6 18" /></I>;
