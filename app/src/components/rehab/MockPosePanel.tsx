import { useEffect, useRef, useState } from 'react';
import coreConfig from '@vision/games/rehab/core/config.json';
import { LM, type P2 } from '@vision/games/rehab/core/geometry';
import { DEFAULT_MOCK_PARAMS, MOCK_ASPECT, mockPose, type MockParams } from '@vision/games/rehab/core/mockSkeleton';
import type { MockPoseProvider } from '../../games/rehab/core/providers';

type NumKey = 'hipDropPct' | 'trunkLeanDeg' | 'kneeCaveDeg' | 'toeOutDeg' | 'leftFootLift' | 'rightFootLift' | 'heelLiftPct' | 'distanceScale';

const SLIDERS: { key: NumKey; label: string; min: number; max: number; step: number }[] = [
  { key: 'hipDropPct', label: 'Hip drop %', min: 0, max: 70, step: 1 },
  { key: 'trunkLeanDeg', label: 'Trunk lean °', min: 0, max: 60, step: 1 },
  { key: 'kneeCaveDeg', label: 'Knee cave °', min: 0, max: 25, step: 1 },
  { key: 'toeOutDeg', label: 'Toe-out °', min: 0, max: 40, step: 1 },
  { key: 'leftFootLift', label: 'Left foot lift %', min: 0, max: 50, step: 1 },
  { key: 'rightFootLift', label: 'Right foot lift %', min: 0, max: 50, step: 1 },
  { key: 'heelLiftPct', label: 'Heel lift %', min: 0, max: 15, step: 0.5 },
  { key: 'distanceScale', label: 'Closer ×', min: 0.7, max: 1.3, step: 0.01 },
];

type Joint = 'leftWrist' | 'rightWrist' | 'leftAnkle' | 'rightAnkle';
const JOINTS: { key: Joint; idx: number }[] = [
  { key: 'leftWrist', idx: LM.lWrist },
  { key: 'rightWrist', idx: LM.rWrist },
  { key: 'leftAnkle', idx: LM.lAnkle },
  { key: 'rightAnkle', idx: LM.rAnkle },
];

const BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], [15, 19], [16, 20],
];

interface MockPosePanelProps {
  provider: MockPoseProvider;
  demo: boolean;
  onDemo: (on: boolean) => void;
}

/**
 * Development panel for the synthetic skeleton: sliders, toggles, draggable
 * wrists and ankles (2-bone IK), and the game's scripted demo.
 */
export function MockPosePanel({ provider, demo, onDemo }: MockPosePanelProps) {
  const [params, setParams] = useState<MockParams>(provider.params);
  const [open, setOpen] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Joint | null>(null);

  const update = (patch: Partial<MockParams>) => {
    const next = { ...provider.params, ...patch };
    provider.params = next;
    setParams(next);
  };

  // Mirror view of the mock (as the patient sees it) for dragging limbs.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) {
        const pose = mockPose(provider.params, performance.now() / 1000);
        ctx.clearRect(0, 0, c.width, c.height);
        if (pose) {
          const pt = (i: number) => ({ x: (1 - pose.landmarks[i].x) * c.width, y: pose.landmarks[i].y * c.height });
          ctx.lineWidth = 1.5;
          for (const [a, b] of BONES) {
            const pa = pt(a);
            const pb = pt(b);
            ctx.strokeStyle = a % 2 === 1 && b % 2 === 1 ? coreConfig.colors.left : a % 2 === 0 && b % 2 === 0 ? coreConfig.colors.right : coreConfig.colors.grey;
            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
          }
          for (const j of JOINTS) {
            const p = pt(j.idx);
            ctx.strokeStyle = provider.params[j.key] ? coreConfig.colors.good : '#fff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [provider]);

  const toNorm = (e: React.PointerEvent<HTMLCanvasElement>): P2 => {
    const c = e.currentTarget;
    const x = e.nativeEvent.offsetX / c.clientWidth;
    const y = e.nativeEvent.offsetY / c.clientHeight;
    // The preview is mirrored; mock coordinates are camera coordinates.
    return { x: 1 - x, y };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pose = mockPose(provider.params, performance.now() / 1000);
    if (!pose) return;
    const p = toNorm(e);
    let best: Joint | null = null;
    let bestD = 0.06;
    for (const j of JOINTS) {
      const l = pose.landmarks[j.idx];
      const d = Math.hypot((l.x - p.x) * MOCK_ASPECT, l.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = j.key;
      }
    }
    if (best) {
      dragRef.current = best;
      e.currentTarget.setPointerCapture(e.pointerId);
      update({ [best]: p } as Partial<MockParams>);
    }
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const j = dragRef.current;
    if (j) update({ [j]: toNorm(e) } as Partial<MockParams>);
  };

  const toggle = (key: 'tracking' | 'secondPerson' | 'heelKick' | 'hideFingertips') => update({ [key]: !params[key] } as Partial<MockParams>);

  return (
    <div className="rehab-mock" data-testid="rehab-mock-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Mock skeleton</strong>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open ? (
        <>
          <div className="row">
            <button type="button" aria-pressed={demo} onClick={() => onDemo(!demo)}>
              Scripted demo
            </button>
            <button type="button" aria-pressed={params.view === 'side'} onClick={() => update({ view: params.view === 'side' ? 'front' : 'side' })}>
              View: {params.view}
            </button>
            <button type="button" aria-pressed={params.tracking} onClick={() => toggle('tracking')}>
              Tracking {params.tracking ? 'on' : 'off'}
            </button>
            <button type="button" aria-pressed={params.secondPerson} onClick={() => toggle('secondPerson')}>
              Second person
            </button>
            <button type="button" aria-pressed={params.heelKick} onClick={() => toggle('heelKick')}>
              Heel kick
            </button>
            <button type="button" aria-pressed={params.hideFingertips} onClick={() => toggle('hideFingertips')}>
              Hide fingertips
            </button>
            <button type="button" onClick={() => update({ leftWrist: null, rightWrist: null, leftAnkle: null, rightAnkle: null })}>
              Reset limbs
            </button>
            <button type="button" onClick={() => update({ ...DEFAULT_MOCK_PARAMS })}>
              Reset all
            </button>
          </div>
          {SLIDERS.map((s) => (
            <label key={s.key}>
              <span>{s.label}</span>
              <input type="range" min={s.min} max={s.max} step={s.step} value={params[s.key]} onChange={(e) => update({ [s.key]: Number(e.target.value) } as Partial<MockParams>)} />
              <span>{params[s.key]}</span>
            </label>
          ))}
          <canvas
            ref={canvasRef}
            width={320}
            height={180}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => {
              dragRef.current = null;
            }}
            aria-label="Drag the wrists and ankles"
          />
        </>
      ) : null}
    </div>
  );
}
