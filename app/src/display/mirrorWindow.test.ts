import { describe, expect, it } from 'vitest';
import { buildDisplaySnapshot, type MonitorReading } from './smartMirrorDisplay';
import {
  canStartMirrorOpen,
  findReturnedDisplay,
  isSmartMirrorWindowLabel,
  mirrorBoundsChanged,
  nextMirrorPhase,
  planSmartMirrorOpen,
} from './mirrorWindow';

const laptop: MonitorReading = {
  name: 'Laptop',
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scaleFactor: 1.25,
};

const tv: MonitorReading = {
  name: 'TV',
  x: -1080,
  y: 0,
  width: 1080,
  height: 1920,
  scaleFactor: 1.5,
};

function displays(monitors: MonitorReading[], topology: 'extend' | 'clone' | 'single' | 'unknown' = 'extend') {
  return buildDisplaySnapshot({
    runtimeAvailable: true,
    topology,
    monitors,
    primary: monitors[0] ?? null,
  });
}

describe('planSmartMirrorOpen', () => {
  it('does not open a window when no external display exists', () => {
    const plan = planSmartMirrorOpen(displays([laptop], 'single'));
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.choices).toEqual([]);
      expect(plan.message).toContain('No external display');
    }
  });

  it('does not open a window while Windows is duplicating the desktop', () => {
    const plan = planSmartMirrorOpen(displays([laptop], 'clone'));
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain('Extend');
  });

  it('positions the selected portrait display, including a screen to the left', () => {
    const plan = planSmartMirrorOpen(displays([laptop, tv]));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.display.name).toBe('TV');
    expect(plan.bounds).toEqual({
      x: -720,
      y: 0,
      width: 720,
      height: 1280,
      physicalX: -540,
      physicalY: 960,
    });
  });

  it('asks for an explicit display instead of choosing between several', () => {
    const left: MonitorReading = { name: 'Left', x: -1920, y: 0, width: 1920, height: 1080, scaleFactor: 1 };
    const right: MonitorReading = { name: 'Right', x: 1920, y: 0, width: 1920, height: 1080, scaleFactor: 1 };
    const snapshot = displays([laptop, left, right]);
    const pending = planSmartMirrorOpen(snapshot);
    expect(pending.ok).toBe(false);
    if (pending.ok) return;
    const chosen = planSmartMirrorOpen(snapshot, pending.choices[1]?.id);
    expect(chosen.ok).toBe(true);
    if (chosen.ok) expect(chosen.display.name).toBe('Right');
  });

  it('follows a resolution and orientation change on the same display', () => {
    const before = planSmartMirrorOpen(displays([laptop, tv]));
    const rotated: MonitorReading = { ...tv, width: 1920, height: 1080, scaleFactor: 1 };
    const after = planSmartMirrorOpen(displays([laptop, rotated]));
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(mirrorBoundsChanged(before.bounds, after.bounds)).toBe(true);
    expect(after.bounds.width).toBe(1920);
    expect(after.bounds.height).toBe(1080);
  });
});

describe('mirror window lifecycle', () => {
  it('recognizes only the dedicated mirror window', () => {
    expect(isSmartMirrorWindowLabel('smart-mirror')).toBe(true);
    expect(isSmartMirrorWindowLabel('main')).toBe(false);
    expect(isSmartMirrorWindowLabel(null)).toBe(false);
  });

  it('ignores a second open while the first request is still running', () => {
    expect(canStartMirrorOpen(true)).toBe(false);
    expect(canStartMirrorOpen(false)).toBe(true);
  });

  it('waits when the TV disappears and reopens when it returns', () => {
    expect(nextMirrorPhase({
      phase: 'open',
      displayPresent: false,
      windowOpen: true,
      openedRecently: false,
    })).toBe('waiting-for-display');
    expect(nextMirrorPhase({
      phase: 'waiting-for-display',
      displayPresent: true,
      windowOpen: false,
      openedRecently: false,
    })).toBe('open');
  });

  it('treats a closed mirror window as closed when the display is still connected', () => {
    expect(nextMirrorPhase({
      phase: 'open',
      displayPresent: true,
      windowOpen: false,
      openedRecently: false,
    })).toBe('closed');
    expect(nextMirrorPhase({
      phase: 'open',
      displayPresent: true,
      windowOpen: false,
      openedRecently: true,
    })).toBe('open');
  });

  it('matches a reconnected display by id or unique name', () => {
    const snapshot = displays([laptop, tv]);
    const tvDisplay = snapshot.displays[1];
    expect(tvDisplay).toBeDefined();
    if (!tvDisplay) return;
    expect(findReturnedDisplay(snapshot.displays, tvDisplay)?.id).toBe(tvDisplay.id);
    expect(findReturnedDisplay(snapshot.displays, { id: 'gone', name: 'TV' })?.name).toBe('TV');
    expect(findReturnedDisplay(snapshot.displays, { id: 'gone', name: 'Missing' })).toBeNull();
  });
});
