import { cn } from '@/lib/utils';
import { rangeSummaryRows, setViewDescription, type CompletedRangeSet } from '../../exercise/rangeModelSession';

export interface RangeSetSummaryProps {
  set: CompletedRangeSet;
  /** Mirror cards are small and dark; the clinical screen has room. */
  variant: 'clinical' | 'mirror';
  className?: string;
}

/** After a squat or lunge set: how many reps were correct, borderline and incorrect, per angle. */
export function RangeSetSummary({ set, variant, className }: RangeSetSummaryProps) {
  const rows = rangeSummaryRows(set.summary);
  const mirror = variant === 'mirror';
  const { summary } = set;
  return (
    <div
      data-testid="range-set-summary"
      className={cn(
        'w-full text-left',
        mirror ? 'max-w-[18rem] text-xs text-white' : 'max-w-xl rounded-2xl border border-white/10 bg-card/40 p-5 text-base',
        className,
      )}
    >
      <p className={cn('font-semibold', mirror ? 'text-sm' : 'text-lg')}>
        Set {set.setNumber} · {set.model.label}
      </p>
      <p className={cn('mt-0.5', mirror ? 'text-neutral-300' : 'text-muted-foreground')}>
        {setViewDescription(set.model, set.view)}
      </p>
      <p className={cn('mt-2 tabular-nums', mirror ? '' : 'text-lg')}>
        <span className="text-emerald-400">{summary.correct} correct</span>
        {' · '}
        <span className="text-amber-300">{summary.borderline} borderline</span>
        {' · '}
        <span className="text-red-400">{summary.incorrect} incorrect</span>
      </p>
      {rows.length > 0 ? (
        <table className={cn('mt-3 w-full tabular-nums', mirror ? 'text-[0.7rem]' : 'text-sm')}>
          <thead>
            <tr className={mirror ? 'text-neutral-300' : 'text-muted-foreground'}>
              <th className="py-1 text-left font-medium">Angle</th>
              <th className="py-1 text-right font-medium">Correct</th>
              <th className="py-1 text-right font-medium">Borderline</th>
              <th className="py-1 text-right font-medium">Incorrect</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-white/10">
                <td className="py-1">{row.label}</td>
                <td className="py-1 text-right text-emerald-400">{row.correct}</td>
                <td className="py-1 text-right text-amber-300">{row.borderline}</td>
                <td className="py-1 text-right text-red-400">{row.incorrect}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={cn('mt-2', mirror ? 'text-neutral-300' : 'text-muted-foreground')}>No reps were judged in this set.</p>
      )}
    </div>
  );
}
