import { forwardRef, useState } from 'react';
import type { Alignment, PoseSourceKind, RehabSettings } from '../../games/rehab/core/settings';
import { exportCsv } from '../../games/rehab/core/storage';
import { RehabButton, SilhouetteGuide } from './rehabUi';

interface RehabGearProps {
  settings: RehabSettings;
  onChange: (next: RehabSettings) => void;
  onAlignment: () => void;
  onBack: () => void;
  wsStatus: string | null;
}

function Stepper({ label, value, unit, onStep, step }: { label: string; value: number; unit: string; step: number; onStep: (delta: number) => void }) {
  return (
    <div className="rehab-gear-row">
      <span>{label}</span>
      <div>
        <RehabButton small aria-label={`Decrease ${label}`} onClick={() => onStep(-step)}>
          −
        </RehabButton>
        <span style={{ minWidth: '4.5em', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
          {value}
          {unit}
        </span>
        <RehabButton small aria-label={`Increase ${label}`} onClick={() => onStep(step)}>
          +
        </RehabButton>
      </div>
    </div>
  );
}

const SOURCES: { id: PoseSourceKind; label: string }[] = [
  { id: 'camera', label: 'Camera' },
  { id: 'mock', label: 'Mock' },
  { id: 'websocket', label: 'WebSocket' },
];

/** Gear menu: alignment, sound, latency, leg factors, assist, pose source, CSV export. */
export function RehabGear({ settings, onChange, onAlignment, onBack, wsStatus }: RehabGearProps) {
  const [csvNote, setCsvNote] = useState<string | null>(null);
  const set = (patch: Partial<RehabSettings>) => onChange({ ...settings, ...patch });
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  return (
    <div className="rehab-gear" data-testid="rehab-gear-menu">
      <div className="rehab-gear-row">
        <strong>Settings</strong>
        <RehabButton small data-testid="rehab-gear-back" onClick={onBack}>
          Back
        </RehabButton>
      </div>
      <div className="rehab-gear-row">
        <span>Mirror alignment</span>
        <RehabButton small onClick={onAlignment}>
          Align
        </RehabButton>
      </div>
      <div className="rehab-gear-row">
        <span>Sound</span>
        <RehabButton small selected={!settings.muted} onClick={() => set({ muted: !settings.muted })}>
          {settings.muted ? 'Off' : 'On'}
        </RehabButton>
      </div>
      <Stepper label="Audio offset" value={settings.audioOffsetMs} unit=" ms" step={10} onStep={(d) => set({ audioOffsetMs: clamp(settings.audioOffsetMs + d, -500, 500) })} />
      <Stepper label="Camera latency" value={settings.cameraLatencyMs} unit=" ms" step={10} onStep={(d) => set({ cameraLatencyMs: clamp(settings.cameraLatencyMs + d, 0, 600) })} />
      <Stepper
        label="Left leg height"
        value={settings.legFactor.left}
        unit="×"
        step={0.05}
        onStep={(d) => set({ legFactor: { ...settings.legFactor, left: round2(clamp(settings.legFactor.left + d, 0.5, 1.5)) } })}
      />
      <Stepper
        label="Right leg height"
        value={settings.legFactor.right}
        unit="×"
        step={0.05}
        onStep={(d) => set({ legFactor: { ...settings.legFactor, right: round2(clamp(settings.legFactor.right + d, 0.5, 1.5)) } })}
      />
      <div className="rehab-gear-row">
        <span>March assist mode</span>
        <RehabButton small selected={settings.assist} onClick={() => set({ assist: !settings.assist })}>
          {settings.assist ? 'On' : 'Off'}
        </RehabButton>
      </div>
      <div className="rehab-gear-row">
        <span>Pose source{settings.poseSource === 'websocket' && wsStatus ? ` (${wsStatus})` : ''}</span>
        <div>
          {SOURCES.map((s) => (
            <RehabButton key={s.id} small selected={settings.poseSource === s.id} data-testid={`rehab-source-${s.id}`} onClick={() => set({ poseSource: s.id })}>
              {s.label}
            </RehabButton>
          ))}
        </div>
      </div>
      <div className="rehab-gear-row">
        <span>Debug skeleton (D)</span>
        <RehabButton small selected={settings.debugSkeleton} onClick={() => set({ debugSkeleton: !settings.debugSkeleton })}>
          {settings.debugSkeleton ? 'On' : 'Off'}
        </RehabButton>
      </div>
      <div className="rehab-gear-row">
        <span>{csvNote ?? 'Session log'}</span>
        <RehabButton
          small
          onClick={() => {
            exportCsv()
              .then((n) => setCsvNote(n ? `Exported ${n} sessions` : 'No sessions yet'))
              .catch(() => setCsvNote('Could not read the log on this device'));
          }}
        >
          Export CSV
        </RehabButton>
      </div>
    </div>
  );
}

interface RehabAlignmentProps {
  alignment: Alignment;
  onChange: (next: Alignment) => void;
  onDone: () => void;
}

export const ALIGN_STEP = 0.005;
export const ALIGN_SCALE_STEP = 0.02;

export function nudgeAlignment(a: Alignment, key: string): Alignment | null {
  switch (key) {
    case 'ArrowLeft':
      return { ...a, offsetX: a.offsetX - ALIGN_STEP };
    case 'ArrowRight':
      return { ...a, offsetX: a.offsetX + ALIGN_STEP };
    case 'ArrowUp':
      return { ...a, offsetY: a.offsetY - ALIGN_STEP };
    case 'ArrowDown':
      return { ...a, offsetY: a.offsetY + ALIGN_STEP };
    case '+':
    case '=':
    case 'PageUp':
      return { ...a, scale: Math.min(3, a.scale + ALIGN_SCALE_STEP) };
    case '-':
    case '_':
    case 'PageDown':
      return { ...a, scale: Math.max(0.3, a.scale - ALIGN_SCALE_STEP) };
    default:
      return null;
  }
}

/** Live markers on hips and shoulders; arrows move them onto the reflection, +/- scale. */
export const RehabAlignment = forwardRef<HTMLDivElement, RehabAlignmentProps>(function RehabAlignment({ alignment, onChange, onDone }, markersRef) {
  const nudge = (key: string) => {
    const next = nudgeAlignment(alignment, key);
    if (next) onChange(next);
  };
  return (
    <div className="rehab-layer" data-testid="rehab-alignment">
      <SilhouetteGuide progress={0} locked={false} />
      <div ref={markersRef} className="rehab-layer" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="rehab-marker" style={{ display: 'none' }} />
        ))}
      </div>
      <div className="rehab-centre" style={{ justifyContent: 'flex-end', paddingBottom: 'calc(var(--u) * 1.2)' }}>
        <p className="rehab-small">Move the green circles onto your hips and shoulders in the mirror.</p>
        <div className="rehab-chips" style={{ pointerEvents: 'auto' }}>
          <RehabButton small onClick={() => nudge('ArrowLeft')}>←</RehabButton>
          <RehabButton small onClick={() => nudge('ArrowUp')}>↑</RehabButton>
          <RehabButton small onClick={() => nudge('ArrowDown')}>↓</RehabButton>
          <RehabButton small onClick={() => nudge('ArrowRight')}>→</RehabButton>
          <RehabButton small onClick={() => nudge('-')}>Smaller</RehabButton>
          <RehabButton small onClick={() => nudge('+')}>Bigger</RehabButton>
          <RehabButton small onClick={() => onChange({ offsetX: 0, offsetY: 0, scale: 1 })}>Reset</RehabButton>
          <RehabButton small data-testid="rehab-align-done" onClick={onDone}>Done</RehabButton>
        </div>
      </div>
    </div>
  );
});
