import { beforeEach, describe, expect, it } from 'vitest';
import {
  createBird,
  DEFAULT_BIRD_FLIGHT_CONFIG,
  maybeSpawnBird,
  resetBirdIds,
  tickBirds,
} from './birdFlight';

describe('birdFlight', () => {
  beforeEach(() => {
    resetBirdIds();
  });

  it('moves birds horizontally', () => {
    const bird = createBird(800, 600, DEFAULT_BIRD_FLIGHT_CONFIG);
    bird.direction = 1;
    bird.speed = 100;
    bird.x = 100;
    const next = tickBirds([bird], 1000, 800);
    expect(next[0]?.x).toBe(200);
  });

  it('removes birds that leave the screen', () => {
    const bird = createBird(800, 600, DEFAULT_BIRD_FLIGHT_CONFIG);
    bird.direction = 1;
    bird.x = 900;
    bird.speed = 50;
    const next = tickBirds([bird], 1000, 800);
    expect(next).toHaveLength(0);
  });

  it('spawns on interval', () => {
    const first = maybeSpawnBird([], 0, -Infinity, 800, 600, {
      ...DEFAULT_BIRD_FLIGHT_CONFIG,
      spawnIntervalMs: 1000,
    });
    expect(first.birds).toHaveLength(1);
    const second = maybeSpawnBird(first.birds, 500, first.lastSpawnMs, 800, 600, {
      ...DEFAULT_BIRD_FLIGHT_CONFIG,
      spawnIntervalMs: 1000,
    });
    expect(second.birds).toHaveLength(1);
  });
});
