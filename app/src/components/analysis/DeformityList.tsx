import type { AnalysisDeformity, AnalysisResponse } from '../../api/types';
import { cn } from '../../lib/utils';

/** False only when the analysis says the capture could not be read. Older analyses were. */
export function analysisWasPossible(analysis: Pick<AnalysisResponse, 'analysisPossible'>): boolean {
  return analysis.analysisPossible !== false;
}

const REGION_LABELS: Record<string, string> = {
  head_neck: 'Head and neck',
  shoulder: 'Shoulder',
  upper_arm_elbow: 'Upper arm and elbow',
  forearm_hand: 'Forearm and hand',
  chest: 'Chest',
  upper_back: 'Upper back',
  lower_back: 'Lower back',
  abdomen: 'Abdomen',
  pelvis_hip: 'Pelvis and hip',
  thigh: 'Thigh',
  knee: 'Knee',
  lower_leg_ankle: 'Lower leg and ankle',
  foot: 'Foot',
};

function severityLabel(severity: number): string {
  if (severity >= 0.67) return 'Pronounced';
  if (severity >= 0.34) return 'Moderate';
  return 'Mild';
}

function placeLabel(deformity: AnalysisDeformity): string {
  const region = REGION_LABELS[deformity.region] ?? deformity.region;
  const sided = deformity.side === 'left' || deformity.side === 'right' || deformity.side === 'bilateral';
  return sided ? `${region}, ${deformity.side}` : region;
}

interface DeformityListProps {
  deformities: AnalysisDeformity[] | undefined;
  /** `mirror` matches the dark Smart Mirror results screen. */
  tone?: 'default' | 'mirror';
  className?: string;
}

/** Every deformity the analysis found, most pronounced first. */
export function DeformityList({ deformities, tone = 'default', className }: DeformityListProps) {
  if (!deformities || deformities.length === 0) return null;
  const mirror = tone === 'mirror';
  return (
    <section className={cn('space-y-2', className)} data-testid="deformity-list">
      <h2 className={cn('text-sm font-semibold', mirror ? 'text-white' : 'text-foreground')}>
        Deformities found ({deformities.length})
      </h2>
      <ul className="space-y-2">
        {deformities.map((deformity, index) => (
          <li
            key={`${deformity.name}-${index}`}
            className={cn('rounded-lg border px-3 py-2', mirror ? 'border-white/20' : 'bg-background/60')}
          >
            <p className={cn('text-sm font-medium', mirror ? 'text-white' : 'text-foreground')}>{deformity.name}</p>
            <p className={cn('text-xs', mirror ? 'text-neutral-300' : 'text-muted-foreground')}>
              {placeLabel(deformity)} · {severityLabel(deformity.severity)}
            </p>
            {deformity.description !== deformity.name ? (
              <p className={cn('mt-1 text-xs leading-relaxed', mirror ? 'text-neutral-400' : 'text-muted-foreground')}>
                {deformity.description}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
