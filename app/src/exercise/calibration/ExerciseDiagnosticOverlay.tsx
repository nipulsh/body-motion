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
