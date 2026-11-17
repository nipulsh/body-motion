import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const HOVER_ATTR = 'data-rehab-target';

interface RehabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  /** Hover dwell before activation, seconds. */
  dwell?: number;
  /** Works by hand hover even while the game blocks hover menus (Hurts). */
  always?: boolean;
  selected?: boolean;
  /** Filled with the site primary colour. The forward action on a screen. */
  primary?: boolean;
  danger?: boolean;
  small?: boolean;
  icon?: boolean;
}

/** Outlined mirror button. Hand hover, touch, mouse and keyboard all activate it. */
export function RehabButton({ children, dwell, always, selected, primary, danger, small, icon, className, ...rest }: RehabButtonProps) {
  return (
    <button
      type="button"
      {...{ [HOVER_ATTR]: 'true' }}
      data-dwell={dwell}
      data-rehab-always={always ? 'true' : undefined}
      aria-pressed={selected === undefined ? undefined : selected}
      className={cn('rehab-btn', selected && 'is-selected', primary && 'is-primary', danger && 'is-danger', small && 'is-small', icon && 'rehab-icon-btn', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function OutlineIcon({ d, color = 'currentColor', strokeWidth = 1.8 }: { d: string; color?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  exit: 'M6 6l12 12 M18 6L6 18',
  pause: 'M9 5v14 M15 5v14',
  play: 'M8 5l11 7-11 7z',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0.01 0 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
};

export function Stars({ count, max = 3, className }: { count: number; max?: number; className?: string }) {
  return (
    <span className={cn('rehab-stars', className)} aria-label={`${count} of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => (
        <OutlineIcon key={i} d={ICONS.star} color={i < count ? 'var(--chart-3)' : 'var(--muted-foreground)'} strokeWidth={i < count ? 2.4 : 1.4} />
      ))}
    </span>
  );
}

/** Thin ring timer: `value` 1 = full, 0 = empty. */
export function RingTimer({ value }: { value: number }) {
  const r = 10;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg className="rehab-ring-timer" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r={r} fill="none" stroke="color-mix(in oklab, var(--primary) 28%, transparent)" strokeWidth="1.5" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.8"
        strokeDasharray={`${c * v} ${c}`}
        transform="rotate(-90 12 12)"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Thin outline of a standing person, shown during the base pose check and alignment. */
export function SilhouetteGuide({ progress, locked }: { progress: number; locked: boolean }) {
  const colour = locked ? 'var(--chart-2)' : progress > 0 ? 'var(--chart-3)' : 'var(--foreground)';
  return (
    <svg className="rehab-silhouette" viewBox="0 0 100 260" fill="none" stroke={colour} strokeWidth="1.2" aria-hidden>
      <circle cx="50" cy="20" r="13" />
      <path d="M50 33v6 M28 46c6-5 38-5 44 0 M28 46l-8 52 M72 46l8 52 M20 98l-3 30 M80 98l3 30 M30 48l2 62h36l2-62 M32 110l-4 70 M68 110l4 70 M28 180l-2 70 M72 180l2 70 M26 250h-10 M74 250h10 M50 112v40" />
      {!locked && progress > 0 ? (
        <circle cx="50" cy="20" r="18" stroke="var(--chart-2)" strokeWidth="1.5" strokeDasharray={`${progress * 113} 113`} transform="rotate(-90 50 20)" />
      ) : null}
    </svg>
  );
}
