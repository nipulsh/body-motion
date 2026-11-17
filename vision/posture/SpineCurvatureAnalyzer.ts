import type { RawBackContour, ContourWindow } from './BackContourExtractor';

/** One region's outline estimate. Not a vertebral angle. */
export interface RegionCurvature {
  /**
   * Posterior curvature as an equivalent sagitta over the hip–shoulder length.
   * Positive bows out of the back. Scale comes out because it is a fraction of that length.
   */
  sagitta: number | null;
  /** 0–1, from how much of the window was found and how tightly it fit. */
  confidence: number;
}

export interface SpineCurvature {
  /** Full-span bulge as a fraction of hip–shoulder length. */
  bulgeRatio: number;
  /** Full-span outline turn in degrees, for display. Classification does not use it. */
  bendDeg: number;
  thoracic: RegionCurvature;
  lumbar: RegionCurvature;
}

const EMPTY_REGION: RegionCurvature = { sagitta: null, confidence: 0 };

/**
 * Residual (pixels) at which confidence from the fit falls to zero, as a fraction of torso length.
 * A loose outline still returns a sagitta, with a confidence low enough to withhold a warning.
 */
const RESIDUAL_LIMIT_RATIO = 0.08;

function region(window: ContourWindow | null, torsoLengthPx: number): RegionCurvature {
  if (!window || torsoLengthPx <= 0) return EMPTY_REGION;
  const residualScore = 1 - Math.min(1, window.residualPx / (RESIDUAL_LIMIT_RATIO * torsoLengthPx));
  const confidence = Math.max(0, Math.min(1, window.coverage * residualScore));
  // tau runs −1..1 across this window only, so the pixel bulge is span² of the same curve
  // measured over the whole hip–shoulder length. Divide it back out.
  const span = window.span;
  const sagitta = span > 1e-3 ? window.bulgePx / torsoLengthPx / (span * span) : null;
  return { sagitta, confidence };
}

/** Normalize a shared contour into thoracic and lumbar estimates. */
export function analyzeSpineCurvature(contour: RawBackContour): SpineCurvature {
  const length = contour.torsoLengthPx;
  return {
    bulgeRatio: length > 0 ? contour.bulgePx / length : 0,
    bendDeg: contour.bendDeg,
    thoracic: region(contour.thoracic, length),
    lumbar: region(contour.lumbar, length),
  };
}
