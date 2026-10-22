import { fitLandmarkToCanvas } from '@vision/pose/wireframe';
import {
  selectSmartMirrorDisplay,
  type DisplayOrientation,
  type DisplaySnapshot,
} from './smartMirrorDisplay';

export const HARDWARE_PROFILE_STORAGE_KEY = 'bodyexplorer:hardware-calibration:v1';
export const HARDWARE_PROFILE_VERSION = 1;
export const UNKNOWN_MEASUREMENT = 'Unknown';

/** Stated cabinet size. Unverified until someone measures the plastic. */
export const USER_PROVIDED_PLASTIC_HEIGHT_IN = 63;
export const USER_PROVIDED_PLASTIC_WIDTH_IN = 23;

const MAX_LENGTH_IN = 500;
const MAX_OFFSET_IN = 500;

export const CLEAR_MANUAL_CONFIRMATION =
  'Clear entered measurements? Plastic height and width return to 63 and 23 inches. Other fields become empty. The saved profile is kept until you save again.';

export type MeasurementStatus = 'detected' | 'entered' | 'unknown';

export type ManualFieldKey =
  | 'plasticHeightIn'
  | 'plasticWidthIn'
  | 'panelHeightIn'
  | 'panelWidthIn'
  | 'topInsetIn'
  | 'leftInsetIn'
  | 'rightInsetIn'
  | 'gapIn'
  | 'cameraOffsetXIn'
  | 'cameraOffsetYIn'
  | 'horizontalFovDeg'
  | 'verticalFovDeg'
  | 'tiltDeg';

export type ManualFieldRule = 'positive' | 'nonNegative' | 'finite' | 'fov' | 'tilt';

export interface ManualFieldSpec {
  key: ManualFieldKey;
  group: 'plastic' | 'panel' | 'camera';
  label: string;
  unit: 'in' | 'deg';
  rule: ManualFieldRule;
}

export const MANUAL_FIELD_SPECS: readonly ManualFieldSpec[] = [
  { key: 'plasticHeightIn', group: 'plastic', label: 'Height', unit: 'in', rule: 'positive' },
  { key: 'plasticWidthIn', group: 'plastic', label: 'Width', unit: 'in', rule: 'positive' },
  { key: 'panelHeightIn', group: 'panel', label: 'Illuminated height', unit: 'in', rule: 'positive' },
  { key: 'panelWidthIn', group: 'panel', label: 'Illuminated width', unit: 'in', rule: 'positive' },
  { key: 'topInsetIn', group: 'panel', label: 'Top inset', unit: 'in', rule: 'nonNegative' },
  { key: 'leftInsetIn', group: 'panel', label: 'Left inset', unit: 'in', rule: 'nonNegative' },
  { key: 'rightInsetIn', group: 'panel', label: 'Right inset', unit: 'in', rule: 'nonNegative' },
  { key: 'gapIn', group: 'panel', label: 'Glass-to-panel gap', unit: 'in', rule: 'nonNegative' },
  { key: 'cameraOffsetXIn', group: 'camera', label: 'Horizontal offset from TV center', unit: 'in', rule: 'finite' },
  { key: 'cameraOffsetYIn', group: 'camera', label: 'Vertical offset from TV center', unit: 'in', rule: 'finite' },
  { key: 'horizontalFovDeg', group: 'camera', label: 'Horizontal field of view', unit: 'deg', rule: 'fov' },
  { key: 'verticalFovDeg', group: 'camera', label: 'Vertical field of view', unit: 'deg', rule: 'fov' },
  { key: 'tiltDeg', group: 'camera', label: 'Tilt', unit: 'deg', rule: 'tilt' },
] as const;

export type HardwareManualMeasurements = Record<ManualFieldKey, number | null>;
export type HardwareManualDraft = Record<ManualFieldKey, string>;

export interface LetterboxMeasurement {
  offsetX: number;
  offsetY: number;
  drawWidth: number;
  drawHeight: number;
}

export interface HardwareDetectedSnapshot {
  capturedAt: string;
  displayWidth: number | null;
  displayHeight: number | null;
  orientation: DisplayOrientation | null;
  scaleFactor: number | null;
  rotation: number | null;
  cameraWidth: number | null;
  cameraHeight: number | null;
  cameraLabel: string | null;
  cameraDeviceId: string | null;
  canvasWidth: number | null;
  canvasHeight: number | null;
  sourceAspect: number | null;
  letterbox: LetterboxMeasurement | null;
}

export interface HardwareCalibrationProfile {
  version: typeof HARDWARE_PROFILE_VERSION;
  savedAt: string;
  manual: HardwareManualMeasurements;
  detectedSnapshot: HardwareDetectedSnapshot | null;
}

export interface LiveHardwareReading {
  displayWidth: number | null;
  displayHeight: number | null;
  orientation: DisplayOrientation | null;
  scaleFactor: number | null;
  rotation: number | null;
  cameraWidth: number | null;
  cameraHeight: number | null;
  cameraLabel: string | null;
  cameraDeviceId: string | null;
  canvasWidth: number | null;
  canvasHeight: number | null;
  sourceAspect: number | null;
  letterbox: LetterboxMeasurement | null;
  displayMessage: string | null;
}

export interface MeasurementRow {
  id: string;
  label: string;
  text: string;
  status: 'detected' | 'unknown';
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type ProfileParseResult =
  | { ok: true; profile: HardwareCalibrationProfile }
  | { ok: false; message: string };

export type DraftParseResult =
  | { ok: true; manual: HardwareManualMeasurements }
  | { ok: false; message: string };

export type StoredProfileResult =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'ok'; profile: HardwareCalibrationProfile };

const MANUAL_KEYS = MANUAL_FIELD_SPECS.map((field) => field.key);

export function initialManualMeasurements(): HardwareManualMeasurements {
  return {
    plasticHeightIn: USER_PROVIDED_PLASTIC_HEIGHT_IN,
    plasticWidthIn: USER_PROVIDED_PLASTIC_WIDTH_IN,
    panelHeightIn: null,
    panelWidthIn: null,
    topInsetIn: null,
    leftInsetIn: null,
    rightInsetIn: null,
    gapIn: null,
    cameraOffsetXIn: null,
    cameraOffsetYIn: null,
    horizontalFovDeg: null,
    verticalFovDeg: null,
    tiltDeg: null,
  };
}

export function initialManualDraft(): HardwareManualDraft {
  return draftFromManual(initialManualMeasurements());
}

export function draftFromManual(manual: HardwareManualMeasurements): HardwareManualDraft {
  const draft = {} as HardwareManualDraft;
  for (const key of MANUAL_KEYS) {
    const value = manual[key];
    draft[key] = value == null ? '' : String(value);
  }
  return draft;
}

export function manualEntryStatus(raw: string): 'entered' | 'unknown' {
  return raw.trim() === '' ? 'unknown' : 'entered';
}

export function emptyLiveReading(displayMessage: string | null = null): LiveHardwareReading {
  return {
    displayWidth: null,
    displayHeight: null,
    orientation: null,
    scaleFactor: null,
    rotation: null,
    cameraWidth: null,
    cameraHeight: null,
    cameraLabel: null,
    cameraDeviceId: null,
    canvasWidth: null,
    canvasHeight: null,
    sourceAspect: null,
    letterbox: null,
    displayMessage,
  };
}

/** Letterbox box used by fitLandmarkToCanvas. Returns null when either frame is unknown. */
export function measureLetterbox(
  canvasWidth: number | null,
  canvasHeight: number | null,
  sourceWidth: number | null,
  sourceHeight: number | null,
): LetterboxMeasurement | null {
  if (
    canvasWidth == null || canvasHeight == null || sourceWidth == null || sourceHeight == null
    || canvasWidth <= 0 || canvasHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0
  ) {
    return null;
  }
  const origin = fitLandmarkToCanvas(
    { x: 0, y: 0 },
    canvasWidth,
    canvasHeight,
    sourceWidth,
    sourceHeight,
    false,
  );
  const far = fitLandmarkToCanvas(
    { x: 1, y: 1 },
    canvasWidth,
    canvasHeight,
    sourceWidth,
    sourceHeight,
    false,
  );
  const drawWidth = far.x - origin.x;
  const drawHeight = far.y - origin.y;
  if (!(drawWidth > 0) || !(drawHeight > 0)) return null;
  return {
    offsetX: origin.x,
    offsetY: origin.y,
    drawWidth,
    drawHeight,
  };
}

export interface CameraReadingInput {
  width: number | null;
  height: number | null;
  label: string | null;
  deviceId: string | null;
}

export function readLiveHardware(
  snapshot: DisplaySnapshot | null,
  camera: CameraReadingInput | null,
): LiveHardwareReading {
  if (!snapshot) return emptyLiveReading(null);
  const selection = selectSmartMirrorDisplay(snapshot);
  const candidate = selection.status === 'selected' ? selection.candidate : null;
  const displayWidth = candidate && candidate.width > 0 ? candidate.width : null;
  const displayHeight = candidate && candidate.height > 0 ? candidate.height : null;
  const scaleFactor = candidate && candidate.scaleFactor > 0 ? candidate.scaleFactor : null;
  const cameraWidth = camera && camera.width != null && camera.width > 0 ? camera.width : null;
  const cameraHeight = camera && camera.height != null && camera.height > 0 ? camera.height : null;
  const canvasWidth = displayWidth;
  const canvasHeight = displayHeight;
  const sourceAspect = cameraWidth != null && cameraHeight != null ? cameraWidth / cameraHeight : null;
  return {
    displayWidth,
    displayHeight,
    orientation: candidate?.orientation ?? null,
    scaleFactor,
    rotation: candidate?.rotation ?? null,
    cameraWidth,
    cameraHeight,
    cameraLabel: camera?.label?.trim() ? camera.label.trim() : null,
    cameraDeviceId: camera?.deviceId?.trim() ? camera.deviceId.trim() : null,
    canvasWidth,
    canvasHeight,
    sourceAspect,
    letterbox: measureLetterbox(canvasWidth, canvasHeight, cameraWidth, cameraHeight),
    displayMessage: candidate ? null : selection.message,
  };
}

export function snapshotFromLive(live: LiveHardwareReading, capturedAt: string): HardwareDetectedSnapshot {
  return {
    capturedAt,
    displayWidth: live.displayWidth,
    displayHeight: live.displayHeight,
    orientation: live.orientation,
    scaleFactor: live.scaleFactor,
    rotation: live.rotation,
    cameraWidth: live.cameraWidth,
    cameraHeight: live.cameraHeight,
    cameraLabel: live.cameraLabel,
    cameraDeviceId: live.cameraDeviceId,
    canvasWidth: live.canvasWidth,
    canvasHeight: live.canvasHeight,
    sourceAspect: live.sourceAspect,
    letterbox: live.letterbox ? { ...live.letterbox } : null,
  };
}

export function liveReadingRows(reading: LiveHardwareReading | HardwareDetectedSnapshot): MeasurementRow[] {
  return [
    sizeRow('display-width', 'Display width', reading.displayWidth, 'px'),
    sizeRow('display-height', 'Display height', reading.displayHeight, 'px'),
    textRow('display-orientation', 'Orientation', orientationLabel(reading.orientation)),
    textRow('display-scale', 'Scale factor', scaleLabel(reading.scaleFactor)),
    textRow('display-rotation', 'Rotation', reading.rotation == null ? null : `${reading.rotation}°`),
    textRow('camera-resolution', 'Webcam resolution', resolutionLabel(reading.cameraWidth, reading.cameraHeight)),
    textRow('camera-label', 'Webcam name', reading.cameraLabel),
    textRow('camera-device', 'Webcam device ID', reading.cameraDeviceId),
    textRow('canvas-size', 'TV overlay canvas', resolutionLabel(reading.canvasWidth, reading.canvasHeight)),
    textRow('source-aspect', 'Camera frame aspect ratio', aspectLabel(reading.sourceAspect, reading.cameraWidth, reading.cameraHeight)),
    sizeRow('letterbox-width', 'Letterbox width', reading.letterbox?.drawWidth ?? null, 'px'),
    sizeRow('letterbox-height', 'Letterbox height', reading.letterbox?.drawHeight ?? null, 'px'),
    sizeRow('letterbox-offset-x', 'Letterbox offset X', reading.letterbox?.offsetX ?? null, 'px'),
    sizeRow('letterbox-offset-y', 'Letterbox offset Y', reading.letterbox?.offsetY ?? null, 'px'),
  ];
}

function sizeRow(id: string, label: string, value: number | null, unit: string): MeasurementRow {
  return textRow(id, label, value == null ? null : `${formatQuantity(value)} ${unit}`);
}

function textRow(id: string, label: string, value: string | null): MeasurementRow {
  if (!value) return { id, label, text: UNKNOWN_MEASUREMENT, status: 'unknown' };
  return { id, label, text: value, status: 'detected' };
}

function orientationLabel(orientation: DisplayOrientation | null): string | null {
  if (orientation === 'portrait') return 'Portrait';
  if (orientation === 'landscape') return 'Landscape';
  if (orientation === 'square') return 'Square';
  return null;
}

function scaleLabel(scale: number | null): string | null {
  if (scale == null) return null;
  return formatQuantity(scale);
}

function resolutionLabel(width: number | null, height: number | null): string | null {
  if (width == null || height == null) return null;
  return `${formatQuantity(width)} × ${formatQuantity(height)}`;
}

function aspectLabel(aspect: number | null, width: number | null, height: number | null): string | null {
  if (aspect == null || width == null || height == null) return null;
  return `${aspect.toFixed(3)} (${formatQuantity(width)}×${formatQuantity(height)})`;
}

function formatQuantity(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function parseManualDraft(draft: HardwareManualDraft): DraftParseResult {
  const manual = {} as HardwareManualMeasurements;
  for (const field of MANUAL_FIELD_SPECS) {
    const parsed = parseMeasuredField(field, draft[field.key] ?? '');
    if (!parsed.ok) return parsed;
    manual[field.key] = parsed.value;
  }
  return { ok: true, manual };
}

function parseMeasuredField(
  field: ManualFieldSpec,
  raw: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
    return { ok: false, message: `${fieldLabel(field)} must be a number.` };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, message: `${fieldLabel(field)} must be a number.` };
  const message = validateMeasuredValue(field, value);
  if (message) return { ok: false, message };
  return { ok: true, value };
}

function fieldLabel(field: ManualFieldSpec): string {
  const group = field.group === 'plastic' ? 'Plastic' : field.group === 'panel' ? 'TV panel' : 'Webcam';
  return `${group} ${field.label.charAt(0).toLowerCase()}${field.label.slice(1)}`;
}

function validateMeasuredValue(field: ManualFieldSpec, value: number): string | null {
  const label = fieldLabel(field);
  switch (field.rule) {
    case 'positive':
      if (!(value > 0)) return `${label} must be a positive number of inches.`;
      if (value > MAX_LENGTH_IN) return `${label} is outside the supported range.`;
      return null;
    case 'nonNegative':
      if (value < 0) return `${label} is measured inward and cannot be negative.`;
      if (value > MAX_LENGTH_IN) return `${label} is outside the supported range.`;
      return null;
    case 'finite':
      if (Math.abs(value) > MAX_OFFSET_IN) return `${label} is outside the supported range.`;
      return null;
    case 'fov':
      if (!(value > 0) || value > 180) return `${label} must be between 0 and 180 degrees.`;
      return null;
    case 'tilt':
      if (value < -180 || value > 180) return `${label} must be between -180 and 180 degrees.`;
      return null;
    default: {
      const exhaustive: never = field.rule;
      return exhaustive;
    }
  }
}

export function createHardwareProfile(
  manual: HardwareManualMeasurements,
  live: LiveHardwareReading,
  savedAt: string,
): HardwareCalibrationProfile {
  return {
    version: HARDWARE_PROFILE_VERSION,
    savedAt,
    manual: { ...manual },
    detectedSnapshot: snapshotFromLive(live, savedAt),
  };
}

export function hardwareProfileToJson(profile: HardwareCalibrationProfile): string {
  return JSON.stringify(profile, null, 2);
}

export function hardwareProfileFromJson(text: string): ProfileParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: 'This file is not valid JSON.' };
  }
  return parseHardwareProfile(parsed);
}

export function parseHardwareProfile(input: unknown): ProfileParseResult {
  if (!isRecord(input)) return { ok: false, message: 'The file is not a hardware calibration profile.' };
  if (input.version !== HARDWARE_PROFILE_VERSION) {
    return { ok: false, message: 'This profile version is not supported.' };
  }
  if (!isTimestamp(input.savedAt)) {
    return { ok: false, message: 'The profile is missing a save time.' };
  }
  const manual = parseManualRecord(input.manual);
  if (!manual.ok) return manual;
  if (!('detectedSnapshot' in input) || input.detectedSnapshot == null) {
    return {
      ok: true,
      profile: {
        version: HARDWARE_PROFILE_VERSION,
        savedAt: input.savedAt,
        manual: manual.manual,
        detectedSnapshot: null,
      },
    };
  }
  const detected = parseDetectedSnapshot(input.detectedSnapshot);
  if (!detected.ok) return detected;
  return {
    ok: true,
    profile: {
      version: HARDWARE_PROFILE_VERSION,
      savedAt: input.savedAt,
      manual: manual.manual,
      detectedSnapshot: detected.snapshot,
    },
  };
}

export function loadHardwareProfile(storage: KeyValueStorage): StoredProfileResult {
  const raw = storage.getItem(HARDWARE_PROFILE_STORAGE_KEY);
  if (!raw) return { status: 'empty' };
  const parsed = hardwareProfileFromJson(raw);
  if (!parsed.ok) return { status: 'invalid', message: 'The saved profile could not be read. Enter the measurements again.' };
  return { status: 'ok', profile: parsed.profile };
}

export function saveHardwareProfile(profile: HardwareCalibrationProfile, storage: KeyValueStorage): void {
  storage.setItem(HARDWARE_PROFILE_STORAGE_KEY, hardwareProfileToJson(profile));
}

function parseManualRecord(input: unknown): { ok: true; manual: HardwareManualMeasurements } | { ok: false; message: string } {
  if (!isRecord(input)) return { ok: false, message: 'The profile is missing its measurements.' };
  const manual = {} as HardwareManualMeasurements;
  for (const field of MANUAL_FIELD_SPECS) {
    if (!(field.key in input) || input[field.key] == null) {
      manual[field.key] = null;
      continue;
    }
    const value = input[field.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, message: `${fieldLabel(field)} must be a number or empty.` };
    }
    const message = validateMeasuredValue(field, value);
    if (message) return { ok: false, message };
    manual[field.key] = value;
  }
  return { ok: true, manual };
}

function parseDetectedSnapshot(
  input: unknown,
): { ok: true; snapshot: HardwareDetectedSnapshot } | { ok: false; message: string } {
  if (!isRecord(input)) return { ok: false, message: 'The saved detection snapshot is not valid.' };
  if (!isTimestamp(input.capturedAt)) {
    return { ok: false, message: 'The saved detection snapshot is missing its time.' };
  }
  const displayWidth = optionalFinite(input.displayWidth, 'Saved display width');
  if (!displayWidth.ok) return displayWidth;
  const displayHeight = optionalFinite(input.displayHeight, 'Saved display height');
  if (!displayHeight.ok) return displayHeight;
  const scaleFactor = optionalFinite(input.scaleFactor, 'Saved scale factor');
  if (!scaleFactor.ok) return scaleFactor;
  const cameraWidth = optionalFinite(input.cameraWidth, 'Saved webcam width');
  if (!cameraWidth.ok) return cameraWidth;
  const cameraHeight = optionalFinite(input.cameraHeight, 'Saved webcam height');
  if (!cameraHeight.ok) return cameraHeight;
  const canvasWidth = optionalFinite(input.canvasWidth, 'Saved canvas width');
  if (!canvasWidth.ok) return canvasWidth;
  const canvasHeight = optionalFinite(input.canvasHeight, 'Saved canvas height');
  if (!canvasHeight.ok) return canvasHeight;
  const sourceAspect = optionalFinite(input.sourceAspect, 'Saved camera aspect ratio');
  if (!sourceAspect.ok) return sourceAspect;
  const orientation = parseOrientation(input.orientation);
  if (!orientation.ok) return orientation;
  const rotation = parseRotation(input.rotation);
  if (!rotation.ok) return rotation;
  const cameraLabel = optionalText(input.cameraLabel, 'Saved webcam name');
  if (!cameraLabel.ok) return cameraLabel;
  const cameraDeviceId = optionalText(input.cameraDeviceId, 'Saved webcam device ID');
  if (!cameraDeviceId.ok) return cameraDeviceId;
  const letterbox = parseLetterbox(input.letterbox);
  if (!letterbox.ok) return letterbox;
  if (scaleFactor.value != null && !(scaleFactor.value > 0)) {
    return { ok: false, message: 'Saved scale factor must be a positive number.' };
  }
  if (sourceAspect.value != null && !(sourceAspect.value > 0)) {
    return { ok: false, message: 'Saved camera aspect ratio must be a positive number.' };
  }
  return {
    ok: true,
    snapshot: {
      capturedAt: input.capturedAt,
      displayWidth: displayWidth.value,
      displayHeight: displayHeight.value,
      orientation: orientation.value,
      scaleFactor: scaleFactor.value,
      rotation: rotation.value,
      cameraWidth: cameraWidth.value,
      cameraHeight: cameraHeight.value,
      cameraLabel: cameraLabel.value,
      cameraDeviceId: cameraDeviceId.value,
      canvasWidth: canvasWidth.value,
      canvasHeight: canvasHeight.value,
      sourceAspect: sourceAspect.value,
      letterbox: letterbox.value,
    },
  };
}

function parseLetterbox(
  input: unknown,
): { ok: true; value: LetterboxMeasurement | null } | { ok: false; message: string } {
  if (input == null) return { ok: true, value: null };
  if (!isRecord(input)) return { ok: false, message: 'The saved letterbox measurement is not valid.' };
  const offsetX = optionalFinite(input.offsetX, 'Saved letterbox offset X');
  const offsetY = optionalFinite(input.offsetY, 'Saved letterbox offset Y');
  const drawWidth = optionalFinite(input.drawWidth, 'Saved letterbox width');
  const drawHeight = optionalFinite(input.drawHeight, 'Saved letterbox height');
  if (!offsetX.ok) return offsetX;
  if (!offsetY.ok) return offsetY;
  if (!drawWidth.ok) return drawWidth;
  if (!drawHeight.ok) return drawHeight;
  if (offsetX.value == null || offsetY.value == null || drawWidth.value == null || drawHeight.value == null) {
    return { ok: false, message: 'The saved letterbox measurement is incomplete.' };
  }
  if (!(drawWidth.value > 0) || !(drawHeight.value > 0)) {
    return { ok: false, message: 'Saved letterbox width and height must be positive.' };
  }
  return {
    ok: true,
    value: {
      offsetX: offsetX.value,
      offsetY: offsetY.value,
      drawWidth: drawWidth.value,
      drawHeight: drawHeight.value,
    },
  };
}

function parseOrientation(
  input: unknown,
): { ok: true; value: DisplayOrientation | null } | { ok: false; message: string } {
  if (input == null) return { ok: true, value: null };
  if (input === 'portrait' || input === 'landscape' || input === 'square') return { ok: true, value: input };
  return { ok: false, message: 'Saved display orientation is not valid.' };
}

function parseRotation(input: unknown): { ok: true; value: number | null } | { ok: false; message: string } {
  if (input == null) return { ok: true, value: null };
  if (input === 0 || input === 90 || input === 180 || input === 270) return { ok: true, value: input };
  return { ok: false, message: 'Saved display rotation must be 0, 90, 180, 270, or empty.' };
}

function optionalFinite(
  input: unknown,
  label: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (input == null) return { ok: true, value: null };
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return { ok: false, message: `${label} must be a number or empty.` };
  }
  return { ok: true, value: input };
}

function optionalText(
  input: unknown,
  label: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (input == null) return { ok: true, value: null };
  if (typeof input !== 'string' || input.trim() === '' || input.length > 300) {
    return { ok: false, message: `${label} is not valid.` };
  }
  return { ok: true, value: input.trim() };
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 40;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
