import { screen } from 'electron';

function classifyTopology(displays) {
  if (displays.length <= 1) return 'single';
  const primary = screen.getPrimaryDisplay();
  const externals = displays.filter((display) => display.id !== primary.id);
  if (externals.length === 0) return 'single';
  const uniqueBounds = new Set(
    displays.map((display) => `${display.bounds.x},${display.bounds.y},${display.bounds.width},${display.bounds.height}`),
  );
  if (uniqueBounds.size < displays.length) return 'clone';
  return 'extend';
}

export function buildDisplaySnapshot() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const topology = classifyTopology(displays);
  const monitors = displays.map((display) => ({
    name: display.label || null,
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    primary: display.id === primary.id,
  }));

  const primaryReading = monitors.find((monitor) => monitor.primary) ?? null;

  return {
    runtimeAvailable: true,
    topology,
    monitors: monitors.map(({ primary: _primary, ...monitor }) => monitor),
    primary: primaryReading
      ? {
          name: primaryReading.name,
          x: primaryReading.x,
          y: primaryReading.y,
          width: primaryReading.width,
          height: primaryReading.height,
          scaleFactor: primaryReading.scaleFactor,
          rotation: primaryReading.rotation,
        }
      : null,
  };
}

export function findDisplayNear(physicalX, physicalY) {
  const displays = screen.getAllDisplays();
  let best = displays[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const display of displays) {
    const cx = display.bounds.x + display.bounds.width / 2;
    const cy = display.bounds.y + display.bounds.height / 2;
    const distance = (cx - physicalX) ** 2 + (cy - physicalY) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = display;
    }
  }
  return best;
}

export function validatePlacement(placement) {
  const values = [
    placement.x,
    placement.y,
    placement.width,
    placement.height,
    placement.physicalX,
    placement.physicalY,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Display bounds must be finite numbers.');
  }
  if (placement.width <= 0 || placement.height <= 0) {
    throw new Error('Display size must be positive.');
  }
  if (placement.width > 100_000 || placement.height > 100_000) {
    throw new Error('Display size is outside the supported range.');
  }
}
