import type { CSSProperties } from 'react';
import type { CameraTurn } from '@vision/pose/uprightPose';

/** Upright picture shape before the camera reports: a 16:9 camera turned on its side. */
const DEFAULT_UPRIGHT_ASPECT = 9 / 16;

/**
 * Style for a raw camera <video> on a portrait game stage, so it shows the picture the
 * game's pose describes: turned by `turn`, then mirrored if asked, centred, and filling
 * the stage height (a wider picture is cropped at the sides). The stage must set
 * `container-type: size`; `uprightAspect` is the turned picture's width / height.
 */
export function uprightVideoStyle(
  turn: CameraTurn,
  uprightAspect: number | null,
  mirror: boolean,
): CSSProperties {
  const aspect =
    uprightAspect !== null && Number.isFinite(uprightAspect) && uprightAspect > 0
      ? uprightAspect
      : DEFAULT_UPRIGHT_ASPECT;
  const quarter = turn === 90 || turn === 270;
  const uprightWidth = `calc(100cqh * ${aspect})`;
  // The element holds the raw picture. Turned a quarter, its width runs down the stage.
  return {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: quarter ? '100cqh' : uprightWidth,
    height: quarter ? uprightWidth : '100cqh',
    maxWidth: 'none',
    objectFit: 'fill',
    transformOrigin: 'center',
    transform: `translate(-50%, -50%)${mirror ? ' scaleX(-1)' : ''} rotate(${turn}deg)`,
  };
}
