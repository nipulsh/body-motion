/**
 * The SpineTrack skeleton the SpinePose model outputs: 37 body keypoints, nine of them along the spine.
 * https://github.com/dfki-av/spinepose (`SPINE_IDS` in pose_estimator.py).
 */
export const SPINE_TRACK_KEYPOINTS = 37;

/** Pelvis to skull: hip, spine_01..05, neck, neck_02, neck_03. */
export const SPINE_CHAIN_IDS = [19, 26, 27, 28, 29, 30, 18, 35, 36] as const;

export const SPINE_CHAIN_LENGTH = SPINE_CHAIN_IDS.length;

/**
 * Hip up to the base of the neck. Curvature is judged on these; the two points above them
 * move with the head, which is free to look up or down.
 */
export const BACK_STATION_COUNT = 7;

/**
 * Stations each region is read from, by index into the chain. spine_01..03 are the model's lumbar
 * group and spine_04..05 its thoracic group (the colours in its metainfo); spine_03 sits on the
 * boundary and belongs to both. A region needs three stations: on real footage the lower ones are
 * only a few pixels apart, so anything shorter is mostly quantization noise.
 */
export const LUMBAR_STATIONS = [1, 2, 3] as const;
export const MID_THORACIC_STATIONS = [2, 3, 4] as const;
export const THORACIC_STATIONS = [3, 4, 5] as const;
export const OVERALL_STATIONS = [1, 2, 3, 4, 5] as const;

/**
 * T8, T3 and C7: the top three stations still on the back. A neutral upper back keeps them close to
 * a line; the points above C7 move with the head and are left out.
 */
export const UPPER_BACK_LINE_STATIONS = [4, 5, 6] as const;

/**
 * Hip centre and L3. The line between them stands in for the pelvis in a camera estimate of pelvic
 * tilt. spine_01 (L5) is closer to the sacrum but sits only a few pixels from the hip centre.
 */
export const PELVIS_STATIONS = [0, 2] as const;

/** Decoded model output, in pixels of the model's input crop. */
export interface SpineKeypoints {
  x: Float32Array;
  y: Float32Array;
  /** SimCC peak value. Not a probability: it runs above 1 on a clear view. */
  score: Float32Array;
}
