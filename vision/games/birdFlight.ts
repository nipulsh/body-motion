export interface Bird {
  id: number;
  x: number;
  y: number;
  speed: number;
  direction: 1 | -1;
  wingPhase: number;
}

export interface BirdFlightConfig {
  minY: number;
  maxY: number;
  spawnIntervalMs: number;
  maxBirds: number;
  minSpeed: number;
  maxSpeed: number;
}

export const DEFAULT_BIRD_FLIGHT_CONFIG: BirdFlightConfig = {
  minY: 0.12,
  maxY: 0.55,
  spawnIntervalMs: 2200,
  maxBirds: 6,
  minSpeed: 0.14,
  maxSpeed: 0.22,
};

let nextBirdId = 1;

export function resetBirdIds(): void {
  nextBirdId = 1;
}

export function createBird(width: number, height: number, config: BirdFlightConfig): Bird {
  const fromLeft = Math.random() < 0.5;
  const yNorm = config.minY + Math.random() * (config.maxY - config.minY);
  const speed =
    config.minSpeed + Math.random() * (config.maxSpeed - config.minSpeed);
  return {
    id: nextBirdId++,
    x: fromLeft ? -40 : width + 40,
    y: yNorm * height,
    speed: speed * width,
    direction: fromLeft ? 1 : -1,
    wingPhase: Math.random() * Math.PI * 2,
  };
}

export function tickBirds(
  birds: Bird[],
  dtMs: number,
  width: number,
): Bird[] {
  const dt = dtMs / 1000;
  const next: Bird[] = [];
  for (const bird of birds) {
    const x = bird.x + bird.direction * bird.speed * dt;
    if (bird.direction > 0 && x > width + 48) continue;
    if (bird.direction < 0 && x < -48) continue;
    next.push({
      ...bird,
      x,
      wingPhase: bird.wingPhase + dt * 8,
    });
  }
  return next;
}

export function maybeSpawnBird(
  birds: Bird[],
  nowMs: number,
  lastSpawnMs: number,
  width: number,
  height: number,
  config: BirdFlightConfig = DEFAULT_BIRD_FLIGHT_CONFIG,
): { birds: Bird[]; lastSpawnMs: number } {
  if (birds.length >= config.maxBirds) {
    return { birds, lastSpawnMs };
  }
  if (nowMs - lastSpawnMs < config.spawnIntervalMs) {
    return { birds, lastSpawnMs };
  }
  return {
    birds: [...birds, createBird(width, height, config)],
    lastSpawnMs: nowMs,
  };
}
