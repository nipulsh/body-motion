import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSmartMirrorHandNavigation } from '../../hooks/useSmartMirrorHandNavigation';
import { useWorkflow } from '../../workflow/WorkflowContext';
import type { WorkflowStage } from '../../workflow/types';
import { formatMirrorHandUnavailableMessage } from './mirrorHandStatusCopy';
import { useMirrorHandNav } from './MirrorHandNavContext';
import { isMirrorGameStage, isMirrorHandNavEnabled } from './mirrorHandNavPolicy';
import { cn } from '@/lib/utils';

interface MirrorHandNavigationLayerProps {
  children: ReactNode;
}

interface MirrorHandStatus {
  enabled: boolean;
  /** Hints sit at the top of the screen, with the other text; the analysis pages keep them at the bottom. */
  atTop: boolean;
  status: ReturnType<typeof useSmartMirrorHandNavigation>['status'];
  error: string | null;
}

const MirrorHandStatusContext = createContext<MirrorHandStatus | null>(null);

/** The analysis capture and results pages keep their own layout; every other page holds its text in the top 40%. */
const BOTTOM_HINT_STAGES: ReadonlySet<WorkflowStage> = new Set<WorkflowStage>([
  'mirror_analysis',
  'mirror_results',
  'mirror_demo_results',
]);

/**
 * Hand-control hints and errors. Render it inside the rotated kiosk stage so the text
 * reads upright on the portrait TV; it shows nothing outside a `MirrorHandNavigationLayer`.
 * On most pages it sits in the strip above the page's own top padding.
 */
export function MirrorHandStatusBanner() {
  const hand = useContext(MirrorHandStatusContext);
  if (!hand?.enabled) return null;
  const { status, error } = hand;
  const place = hand.atTop ? 'top-1' : 'bottom-4';
  if (error && status === 'error') {
    return (
      <p
        className={cn('pointer-events-none absolute left-4 right-4 z-50 text-center text-sm text-amber-300', place)}
        role="status"
      >
        {formatMirrorHandUnavailableMessage(error)}
      </p>
    );
  }
  if (status === 'starting') {
    return (
      <p
        className={cn('pointer-events-none absolute left-4 right-4 z-50 text-center text-xs text-white/70', place)}
        role="status"
      >
        Starting hand control…
      </p>
    );
  }
  if (status === 'ready') {
    return (
      <p
        className={cn('pointer-events-none absolute left-4 right-4 z-50 text-center text-xs text-white/70', place)}
        aria-hidden
      >
        Pinch thumb and index to drag. Spread both hands to zoom the model. Make a fist to select.
      </p>
    );
  }
  return null;
}

export function MirrorHandNavigationLayer({ children }: MirrorHandNavigationLayerProps) {
  const { state } = useWorkflow();
  const { analysisCaptureActive, exerciseHandTrackingActive } = useMirrorHandNav();
  const enabled = isMirrorHandNavEnabled(state.stage, analysisCaptureActive);

  const [navRoot, setNavRoot] = useState<HTMLDivElement | null>(null);
  const onNavRoot = useCallback((node: HTMLDivElement | null) => {
    setNavRoot(node);
  }, []);

  const [hardResetGeneration, setHardResetGeneration] = useState(0);
  const prevEnabledRef = useRef(enabled);

  useEffect(() => {
    if (!enabled) {
      if (isMirrorGameStage(state.stage) || analysisCaptureActive) {
        setHardResetGeneration((generation) => generation + 1);
      }
    }
    prevEnabledRef.current = enabled;
  }, [analysisCaptureActive, enabled, state.stage]);

  const landmarksFromExerciseBus = state.stage === 'mirror_exercise_session' && exerciseHandTrackingActive;
  const { pointer, status, error: handError } = useSmartMirrorHandNavigation(
    navRoot,
    enabled,
    hardResetGeneration,
    landmarksFromExerciseBus,
  );

  return (
    <MirrorHandStatusContext.Provider
      value={{ enabled, atTop: !BOTTOM_HINT_STAGES.has(state.stage), status, error: handError }}
    >
      <div ref={onNavRoot} className="relative h-full min-h-full w-full overflow-hidden">
        {children}
        {/* Window coordinates: the camera and the TV are turned together, so the pointer is never rotated. */}
        {enabled && pointer?.visible ? (
          <div
            className={cn(
              'pointer-events-none fixed z-50 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-[transform,background-color,box-shadow,border-color] duration-150 ease-out motion-reduce:transition-none',
              pointer.overTarget
                ? 'scale-[1.35] border-emerald-200 bg-emerald-400/90 shadow-[0_0_22px_rgba(52,211,153,0.9)]'
                : 'border-cyan-300 bg-cyan-400/80 shadow-[0_0_16px_rgba(34,211,238,0.85)]',
            )}
            style={{ left: pointer.x, top: pointer.y }}
            aria-hidden
            data-testid="mirror-hand-pointer"
          />
        ) : null}
      </div>
    </MirrorHandStatusContext.Provider>
  );
}
