import type { ExerciseFrameDiagnostics } from '@vision';

export interface CalibrationSample {
  timestamp: number;
  jointAngles: Record<string, number | null>;
  confidence: Record<string, number | null>;
  phase: string | null;
  repCount: number;
  trackingState: string;
  feedback: string | null;
}

export class CalibrationRecorder {
  private samples: CalibrationSample[] = [];

  get count(): number {
    return this.samples.length;
  }

  record(diagnostics: ExerciseFrameDiagnostics, timestamp: number): void {
    const jointAngles: Record<string, number | null> = {};
    const confidence: Record<string, number | null> = {};

    for (const [joint, reading] of Object.entries(diagnostics.jointAngles)) {
      jointAngles[joint] = reading.available ? (reading.angle ?? null) : null;
      confidence[joint] = reading.confidence ?? null;
    }

    this.samples.push({
      timestamp,
      jointAngles,
      confidence,
      phase: diagnostics.phase,
      repCount: diagnostics.repCount,
      trackingState: diagnostics.trackingEnabled ? 'tracking' : 'paused_or_countdown',
      feedback: diagnostics.feedback,
    });
  }

  clear(): void {
    this.samples = [];
  }

  exportJsonl(): string {
    return this.samples.map((sample) => JSON.stringify(sample)).join('\n');
  }

  download(filename = 'exercise-calibration.jsonl'): void {
    const blob = new Blob([this.exportJsonl()], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}

export function sampleFromDiagnostics(
  diagnostics: ExerciseFrameDiagnostics,
  timestamp: number,
): CalibrationSample {
  const recorder = new CalibrationRecorder();
  recorder.record(diagnostics, timestamp);
  return recorder.exportJsonl()
    ? (JSON.parse(recorder.exportJsonl().split('\n')[0]!) as CalibrationSample)
    : {
        timestamp,
        jointAngles: {},
        confidence: {},
        phase: diagnostics.phase,
        repCount: diagnostics.repCount,
        trackingState: diagnostics.trackingEnabled ? 'tracking' : 'paused_or_countdown',
        feedback: diagnostics.feedback,
      };
}
