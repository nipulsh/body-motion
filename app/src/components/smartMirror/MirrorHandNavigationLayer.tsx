import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSmartMirrorHandNavigation } from '../../hooks/useSmartMirrorHandNavigation';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { formatMirrorHandUnavailableMessage } from './mirrorHandStatusCopy';
import { useMirrorHandNav } from './MirrorHandNavContext';
import { isMirrorHandNavEnabled } from './mirrorHandNavPolicy';

interface MirrorHandNavigationLayerProps {
  children: ReactNode;
}

export function MirrorHandNavigationLayer({ children }: MirrorHandNavigationLayerProps) {
  const { state } = useWorkflow();
  const { analysisCaptureActive } = useMirrorHandNav();
  const enabled = isMirrorHandNavEnabled(state.stage, analysisCaptureActive);

  const [navRoot, setNavRoot] = useState<HTMLDivElement | null>(null);
  const onNavRoot = useCallback((node: HTMLDivElement | null) => {
    setNavRoot(node);
  }, []);

  const [hardResetGeneration, setHardResetGeneration] = useState(0);
  const prevEnabledRef = useRef(enabled);

  useEffect(() => {
    if (!enabled) {
      if (state.stage === 'balance_bird_game' || analysisCaptureActive) {
        setHardResetGeneration((generation) => generation + 1);
      }
    }
    prevEnabledRef.current = enabled;
  }, [analysisCaptureActive, enabled, state.stage]);

  const { pointer, status, error: handError } = useSmartMirrorHandNavigation(
    navRoot,
    enabled,
    hardResetGeneration,
  );

  return (
    <div ref={onNavRoot} className="relative h-full min-h-full w-full overflow-hidden">
      {children}
      {enabled && pointer?.visible ? (
        <div
          className="pointer-events-none fixed z-50 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300 bg-cyan-400/80 shadow-[0_0_16px_rgba(34,211,238,0.85)]"
          style={{ left: pointer.x, top: pointer.y }}
          aria-hidden
          data-testid="mirror-hand-pointer"
        />
      ) : null}
      {enabled && handError && status === 'error' ? (
        <p
          className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 text-center text-sm text-amber-300"
          role="status"
        >
          {formatMirrorHandUnavailableMessage(handError)}
        </p>
      ) : enabled && status === 'starting' ? (
        <p
          className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 text-center text-xs text-white/70"
          role="status"
        >
          Starting hand control…
        </p>
      ) : enabled && status === 'ready' ? (
        <p
          className="pointer-events-none fixed bottom-4 left-4 right-4 z-50 text-center text-xs text-white/70"
          aria-hidden
        >
          Pinch thumb and index to drag. Spread both hands to zoom the model. Make a fist to select.
        </p>
      ) : null}
    </div>
  );
}
