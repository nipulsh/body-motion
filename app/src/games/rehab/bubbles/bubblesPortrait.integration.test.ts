import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrossOverBubblesGame, type BubbleEvent } from '@vision/games/rehab/bubbles/game';
import { clock } from '../testing/fakes';
import { Harness } from '../testing/harness';
import { bubblesModule } from './bubblesModule';

vi.mock('three', async (importOriginal) => {
  const THREE = await importOriginal<typeof import('three')>();
  const { FakeWebGLRenderer } = await import('../testing/fakes');
  return { ...THREE, WebGLRenderer: FakeWebGLRenderer };
});
vi.mock('../core/audio', async () => ({ RehabAudio: (await import('../testing/fakes')).FakeAudio }));
vi.mock('../core/storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('../core/storage')>();
  return { ...real, saveSession: vi.fn(async () => {}), recordStars: vi.fn(), bestStars: vi.fn(() => 0) };
});

beforeEach(() => {
  vi.spyOn(performance, 'now').mockImplementation(() => clock.ms);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Every bubble as it was the moment it spawned, in screen pixels. */
function recordSpawns(h: Harness) {
  const born: Array<{ x: number; top: number; bottom: number; left: number; right: number }> = [];
  const update = CrossOverBubblesGame.prototype.update;
  vi.spyOn(CrossOverBubblesGame.prototype, 'update').mockImplementation(function (this: CrossOverBubblesGame, ...args) {
    const events: BubbleEvent[] = update.apply(this, args);
    for (const e of events) {
      if (e.type !== 'spawn') continue;
      const b = e.bubble;
      const d = h.engine.display;
      const centre = d.toScreen({ x: b.x, y: b.y });
      const r = b.radius * d.pxPerUnit;
      born.push({ x: centre.x, top: centre.y - r, bottom: centre.y + r, left: centre.x - r, right: centre.x + r });
    }
    return events;
  });
  return born;
}

describe('Cross-Over Bubbles on the 1080×1920 portrait screen (integration)', () => {
  // A patient a little off centre, with the saved alignment zoomed in to match the reflection:
  // the narrow portrait screen then shows less than the patient can reach.
  const settings = { alignment: { offsetX: 0, offsetY: 0, scale: 1.35 } };
  const params = { bodyShiftX: 0.04 };

  for (const level of [1, 2, 3, 4]) {
    it(`L${level + 1}: the demo round only spawns bubbles the patient can see`, () => {
      const h = new Harness(settings, params);
      const born = recordSpawns(h);
      h.start(bubblesModule, level);
      h.until(() => {
        if (h.engine.phase === 'ready') h.engine.confirmReady();
        return h.engine.phase === 'playing';
      }, 15);
      h.demo = true;
      h.until(() => h.ends.length > 0, 400);

      expect(h.ends[0]).toMatchObject({ endedBy: 'complete' });
      expect(born.length).toBeGreaterThan(10);
      for (const b of born) {
        expect(b.left).toBeGreaterThanOrEqual(-0.5);
        expect(b.right).toBeLessThanOrEqual(1080.5);
        expect(b.top).toBeGreaterThanOrEqual(-0.5);
        expect(b.bottom).toBeLessThanOrEqual(1920.5);
      }
    });
  }
});
