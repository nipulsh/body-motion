import type { ExerciseFrameDiagnostics } from '@vision';

function formatJointLine(
  label: string,
  reading: ExerciseFrameDiagnostics['jointAngles'][string] | undefined,
  target?: { start: number; required: number; tolerance: number },
): string | null {
  if (!reading) return null;
  if (!reading.available) {
    return `${label}: unavailable${reading.reason ? ` (${reading.reason})` : ''}`;
  }
  const targetHint = target ? ` target ${target.required}°` : '';
  return `${label}: ${reading.angle?.toFixed(1)}°${targetHint} conf ${(reading.confidence ?? 0).toFixed(2)}`;
}

function formatSagitta(value: number | null): string {
  return value === null ? 'unavailable' : value.toFixed(3);
}

function formatDeg(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}°`;
}

function formatJointLabel(joint: string): string {
  return joint
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatDiagnosticOverlay(diagnostics: ExerciseFrameDiagnostics): string[] {
  const lines = [
    `FPS: ${diagnostics.fps.toFixed(1)}`,
    `Camera: ${diagnostics.cameraWidth ?? '?'}×${diagnostics.cameraHeight ?? '?'}`,
    `Pose confidence: ${diagnostics.poseConfidence?.toFixed(2) ?? '—'}`,
    `Body visible: ${diagnostics.bodyFullyVisible ? 'yes' : 'no'} (${diagnostics.bodyVisibilityScore?.toFixed(2) ?? '—'})`,
    `Tracking: ${diagnostics.trackingEnabled ? 'on' : 'off'}`,
    `Phase: ${diagnostics.phase ?? '—'}`,
    `Rep: ${diagnostics.repCount} / ${diagnostics.targetReps}`,
  ];

  if (diagnostics.feedback) {
    lines.push(`Feedback: ${diagnostics.feedback}`);
  }

  if (diagnostics.deadlift) {
    const deadlift = diagnostics.deadlift;
    const ratio = deadlift.shoulderToTorso === null ? '—' : deadlift.shoulderToTorso.toFixed(2);
    lines.push(`Camera side-on: ${deadlift.cameraSideOn ? 'yes' : 'no'} (${ratio})`);
    lines.push(`Landmarks visible: ${deadlift.landmarksVisible ? 'yes' : 'no'}`);
    lines.push(`Validation: ${deadlift.validation}`);
    lines.push(`Trunk lean: ${deadlift.trunkLeanDeg.toFixed(1)}°`);
    lines.push(`Back angle: ${deadlift.backAngleDeg.toFixed(1)}°`);
    lines.push(`Spine angle: ${deadlift.spineAngleDeg === null ? '—' : `${deadlift.spineAngleDeg.toFixed(1)}°`}`);
    lines.push(`Spine tracking: ${deadlift.spineStatus} (${deadlift.spinePointCount} estimates, conf ${deadlift.spineConfidence.toFixed(2)})`);
    lines.push(`Spine source: ${deadlift.spineSource}${deadlift.spineRejection ? ` (keypoints rejected: ${deadlift.spineRejection})` : ''}`);
    lines.push(
      `Spine model: ${deadlift.spineModelStatus}${deadlift.spineModelBackend ? ` on ${deadlift.spineModelBackend}` : ''}${
        deadlift.spineInferenceMs === null ? '' : `, ${Math.round(deadlift.spineInferenceMs)} ms`
      }`,
    );
    lines.push(`Spine bend above baseline: ${deadlift.spineBendDeltaDeg === null ? '—' : `${deadlift.spineBendDeltaDeg.toFixed(1)}°`}`);
    lines.push(
      `Upper back T8–T3–C7: ${formatDeg(deadlift.upperBackLineDeg)} (${formatDeg(deadlift.upperBackLineDeltaDeg)} above standing${
        deadlift.upperBackLineBent ? ', bent' : ''
      })`,
    );
    lines.push(`Pelvic tilt: ${formatDeg(deadlift.pelvicTiltDeg)} (${formatDeg(deadlift.pelvicTiltDeltaDeg)} from standing)`);
    lines.push(`Trunk inclination 3D: ${formatDeg(deadlift.trunkInclination3dDeg)}`);
    lines.push(`Body yaw: ${formatDeg(deadlift.bodyYawDeg)} (×${deadlift.sagittalStretch.toFixed(2)})`);
    lines.push(`Pose model: ${deadlift.poseModel ?? '—'}`);
    lines.push(`Upper-back curvature: ${formatSagitta(deadlift.upperBackCurvature)} conf ${deadlift.upperBackConfidence.toFixed(2)}`);
    lines.push(`Mid-back curvature: ${formatSagitta(deadlift.midBackCurvature)}`);
    lines.push(`Lower-back curvature: ${formatSagitta(deadlift.lowerBackCurvature)} conf ${deadlift.lowerBackConfidence.toFixed(2)}`);
    lines.push(`Overall curvature: ${formatSagitta(deadlift.overallCurvature)}`);
    lines.push(`Torso inclination: ${deadlift.trunkLeanDeg.toFixed(1)}°`);
    lines.push(`Hip hinge: ${deadlift.hipHingeDeg === null ? '—' : `${deadlift.hipHingeDeg.toFixed(1)}°`}`);
    lines.push(`Segmentation confidence: ${deadlift.segmentationConfidence.toFixed(2)}`);
    const sights = Object.entries(deadlift.landmarkVisibility)
      .map(([name, visibility]) => `${name} ${visibility.toFixed(2)}`)
      .join(', ');
    if (sights) lines.push(`Landmark visibility: ${sights}`);
  }

  for (const [joint, target] of Object.entries(diagnostics.targets)) {
    const line = formatJointLine(formatJointLabel(joint), diagnostics.jointAngles[joint], target);
    if (line) lines.push(line);
  }

  return lines;
}

export function ExerciseDiagnosticOverlay({
  diagnostics,
}: {
  diagnostics: ExerciseFrameDiagnostics;
}) {
  const lines = formatDiagnosticOverlay(diagnostics);
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 max-w-sm rounded-lg border border-emerald-400/40 bg-black/80 p-3 font-mono text-xs leading-relaxed text-emerald-100">
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}
