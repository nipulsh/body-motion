import { cn } from '../../lib/utils';
import { formatContribution } from '../../utils/copy';

interface MuscleContributionProps {
  /** Share (0–100) of the observed deformity attributed to this muscle. */
  percent: number | undefined;
  /** `mirror` matches the dark Smart Mirror results screen. */
  tone?: 'default' | 'mirror';
  className?: string;
}

/** "32% of deformity" with a proportional bar. Renders nothing for analyses without a share. */
export function MuscleContribution({ percent, tone = 'default', className }: MuscleContributionProps) {
  if (percent === undefined || !Number.isFinite(percent)) return null;
  const width = Math.min(100, Math.max(0, percent));
  return (
    <div className={cn('mt-1 flex items-center gap-2', className)} data-testid="muscle-contribution">
      <div
        className={cn(
          'h-1.5 flex-1 overflow-hidden rounded-full',
          tone === 'mirror' ? 'bg-white/15' : 'bg-muted',
        )}
        role="meter"
        aria-label="Share of the posture deformity"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
      >
        <div
          className={cn('h-full rounded-full', tone === 'mirror' ? 'bg-emerald-300' : 'bg-primary')}
          style={{ width: `${width}%` }}
        />
      </div>
      <span
        className={cn(
          'shrink-0 text-xs font-semibold tabular-nums',
          tone === 'mirror' ? 'text-emerald-200' : 'text-foreground',
        )}
      >
        {formatContribution(percent)}
      </span>
    </div>
  );
}

interface MuscleModelNoteProps {
  muscle: { bodyExplorerId?: string; bodyExplorerMeshNames?: string[] };
  tone?: 'default' | 'mirror';
}

/** Explains why selecting this muscle highlights nothing: it has no mesh in the 3D anatomy. */
export function MuscleModelNote({ muscle, tone = 'default' }: MuscleModelNoteProps) {
  const onModel = Boolean(muscle.bodyExplorerId) || (muscle.bodyExplorerMeshNames?.length ?? 0) > 0;
  if (onModel) return null;
  return (
    <p className={cn('mt-1 text-xs italic', tone === 'mirror' ? 'text-neutral-400' : 'text-muted-foreground')}>
      Not shown on the 3D model
    </p>
  );
}

/**
 * Clinician-only: the analysis kept ignoring the strongest measured deviation after a
 * correction. Never rendered on patient-facing (mirror) screens.
 */
export function MeasurementConflictNotice({ conflict }: { conflict: string | undefined }) {
  if (!conflict) return null;
  return (
    // A block span, not a <p>: it is also placed inside paragraph-level page descriptions.
    <span
      role="note"
      className="block rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
    >
      {conflict}
    </span>
  );
}

/** The finding's number, matching its marker on the 3D anatomy map. */
export function FindingNumber({ number, tone = 'default' }: { number: number; tone?: 'default' | 'mirror' }) {
  return (
    <span
      data-testid={`finding-number-${number}`}
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums',
        tone === 'mirror' ? 'size-8 bg-white text-sm text-black' : 'size-6 bg-primary text-xs text-primary-foreground',
      )}
    >
      {number}
    </span>
  );
}
