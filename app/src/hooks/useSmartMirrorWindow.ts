import { useEffect, useRef, useState } from 'react';
import { loadDisplaySnapshot } from '../display/loadDisplays';
import {
  closeSmartMirrorWindow,
  openSmartMirrorWindow,
  smartMirrorWindowIsOpen,
} from '../display/mirrorCommands';
import type { ConnectedDisplay, DisplaySnapshot } from '../display/smartMirrorDisplay';
import {
  canStartMirrorOpen,
  findReturnedDisplay,
  mirrorBoundsChanged,
  mirrorWindowBounds,
  nextMirrorPhase,
  planSmartMirrorOpen,
  type MirrorPhase,
  type MirrorWindowBounds,
} from '../display/mirrorWindow';

export interface SmartMirrorWindowDeps {
  load: () => Promise<DisplaySnapshot>;
  openWindow: (bounds: MirrorWindowBounds) => Promise<'created' | 'focused'>;
  closeWindow: () => Promise<void>;
  isWindowOpen: () => Promise<boolean>;
}

const defaultDeps: SmartMirrorWindowDeps = {
  load: loadDisplaySnapshot,
  openWindow: openSmartMirrorWindow,
  closeWindow: closeSmartMirrorWindow,
  isWindowOpen: smartMirrorWindowIsOpen,
};

const DISPLAY_WATCH_MS = 5000;
const OPEN_GRACE_MS = 1500;

export function useSmartMirrorWindow(deps: SmartMirrorWindowDeps = defaultDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [phase, setPhase] = useState<MirrorPhase>('closed');
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<ConnectedDisplay[]>([]);
  const phaseRef = useRef<MirrorPhase>('closed');
  const selectedRef = useRef<ConnectedDisplay | null>(null);
  const boundsRef = useRef<MirrorWindowBounds | null>(null);
  const openingRef = useRef(false);
  const openedAtRef = useRef(0);

  const place = async (display: ConnectedDisplay) => {
    const bounds = mirrorWindowBounds(display);
    await depsRef.current.openWindow(bounds);
    selectedRef.current = display;
    boundsRef.current = bounds;
    openedAtRef.current = Date.now();
    phaseRef.current = 'open';
    setPhase('open');
    setChoices([]);
    setError(null);
  };

  const open = async (displayId?: string) => {
    if (!canStartMirrorOpen(openingRef.current)) return;
    openingRef.current = true;
    setError(null);
    try {
      const snapshot = await depsRef.current.load();
      const plan = planSmartMirrorOpen(snapshot, displayId);
      if (!plan.ok) {
        setChoices(plan.choices);
        setError(plan.message);
        return;
      }
      await place(plan.display);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Smart Mirror could not be opened.');
    } finally {
      openingRef.current = false;
    }
  };

  const close = async () => {
    phaseRef.current = 'closed';
    selectedRef.current = null;
    boundsRef.current = null;
    setPhase('closed');
    setChoices([]);
    setError(null);
    try {
      await depsRef.current.closeWindow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Smart Mirror could not be closed.');
    }
  };

  useEffect(() => {
    if (phase === 'closed') return;
    let cancelled = false;

    const check = async () => {
      const selected = selectedRef.current;
      if (!selected || cancelled) return;
      try {
        const [snapshot, windowOpen] = await Promise.all([
          depsRef.current.load(),
          depsRef.current.isWindowOpen(),
        ]);
        if (cancelled) return;
        const found = findReturnedDisplay(snapshot.displays, selected);
        const next = nextMirrorPhase({
          phase: phaseRef.current,
          displayPresent: Boolean(found),
          windowOpen,
          openedRecently: Date.now() - openedAtRef.current < OPEN_GRACE_MS,
        });

        if (next === 'waiting-for-display' && phaseRef.current !== 'waiting-for-display') {
          phaseRef.current = 'waiting-for-display';
          setPhase('waiting-for-display');
          setError('The TV disconnected. The mirror will open again when that display is back.');
          await depsRef.current.closeWindow();
          return;
        }

        if (next === 'closed') {
          phaseRef.current = 'closed';
          selectedRef.current = null;
          setPhase('closed');
          return;
        }

        if (next === 'open' && found && phaseRef.current === 'waiting-for-display') {
          await place(found);
          return;
        }

        if (next === 'open' && found && phaseRef.current === 'open') {
          const bounds = mirrorWindowBounds(found);
          if (boundsRef.current && mirrorBoundsChanged(boundsRef.current, bounds)) {
            await depsRef.current.openWindow(bounds);
            boundsRef.current = bounds;
            selectedRef.current = found;
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'The display connection could not be checked.');
        }
      }
    };

    void check();
    const interval = window.setInterval(() => void check(), DISPLAY_WATCH_MS);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [phase]);

  return { phase, error, choices, open, close };
}
