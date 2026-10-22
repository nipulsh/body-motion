import { access, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DemoVideoProbeInfo, DemoVideoValidationIssue } from './demoVideoValidation';
import {
  summarizeValidationIssues,
  validateDemoVideoProbe,
  validateManifestStructure,
} from './demoVideoValidation';

const execFileAsync = promisify(execFile);

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VIDEO_DIR = join(APP_ROOT, 'public/exercise-videos');
const MANIFEST_PATH = join(VIDEO_DIR, 'manifest.json');

export interface ExerciseVideoAssetManifest {
  version?: number;
  description?: string;
  referenceImage?: string;
  videos: Record<string, string>;
}

export interface ExerciseVideoAssetValidationReport {
  manifestPath: string;
  videoDir: string;
  ffprobeAvailable: boolean;
  entriesChecked: number;
  issues: DemoVideoValidationIssue[];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isFfprobeAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

async function probeWithFfprobe(filePath: string): Promise<DemoVideoProbeInfo | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      filePath,
    ]);
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        pix_fmt?: string;
        r_frame_rate?: string;
      }>;
      format?: { duration?: string };
    };

    const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video');
    if (!videoStream) return null;

    const fileStats = await stat(filePath);
    const durationSeconds = parsed.format?.duration
      ? Number.parseFloat(parsed.format.duration)
      : undefined;

    let fps: number | undefined;
    if (videoStream.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      if (num && den) fps = num / den;
    }

    const pixFmt = videoStream.pix_fmt?.toLowerCase() ?? '';
    const hasAlpha = pixFmt.includes('yuva') || pixFmt.includes('rgba');

    return {
      fileSizeBytes: fileStats.size,
      durationSeconds,
      width: videoStream.width,
      height: videoStream.height,
      fps,
      codec: videoStream.codec_name,
      hasAlpha,
    };
  } catch {
    return null;
  }
}

function resolveManifestFilename(filename: string): string {
  const trimmed = filename.trim();
  if (trimmed.startsWith('/')) {
    return join(APP_ROOT, 'public', trimmed.replace(/^\/+/, ''));
  }
  return join(VIDEO_DIR, trimmed.replace(/^\/+/, ''));
}

export async function runExerciseVideoAssetValidation(): Promise<ExerciseVideoAssetValidationReport> {
  const manifestRaw = await readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestRaw) as ExerciseVideoAssetManifest;
  const issues: DemoVideoValidationIssue[] = [];

  issues.push(...validateManifestStructure(manifest));

  const ffprobeAvailable = await isFfprobeAvailable();
  let entriesChecked = 0;

  for (const [exerciseId, filename] of Object.entries(manifest.videos ?? {})) {
    entriesChecked += 1;
    const filePath = resolveManifestFilename(filename);

    if (!(await fileExists(filePath))) {
      issues.push({
        code: 'missing_file',
        severity: 'error',
        exerciseId,
        filename,
        message: `Manifest maps "${exerciseId}" to "${filename}" but file was not found at ${filePath}.`,
      });
      continue;
    }

    const fileStats = await stat(filePath);
    let probe: DemoVideoProbeInfo = { fileSizeBytes: fileStats.size };

    if (ffprobeAvailable) {
      const ffprobeResult = await probeWithFfprobe(filePath);
      if (ffprobeResult) {
        probe = ffprobeResult;
      } else {
        issues.push({
          code: 'ffprobe_failed',
          severity: 'warning',
          exerciseId,
          filename,
          message: `ffprobe could not analyze "${filename}". Basic file-size checks only.`,
        });
      }
    } else if (entriesChecked === 1) {
      issues.push({
        code: 'ffprobe_unavailable',
        severity: 'warning',
        message:
          'ffprobe is not installed; only file existence and size were checked. Install ffmpeg for duration/resolution/alpha validation.',
      });
    }

    issues.push(...validateDemoVideoProbe(filename, probe));
  }

  return {
    manifestPath: MANIFEST_PATH,
    videoDir: VIDEO_DIR,
    ffprobeAvailable,
    entriesChecked,
    issues,
  };
}

export function formatValidationReport(report: ExerciseVideoAssetValidationReport): string {
  const { errors, warnings } = summarizeValidationIssues(report.issues);
  const lines = [
    'Exercise demo video validation',
    `Manifest: ${report.manifestPath}`,
    `Video dir: ${report.videoDir}`,
    `Entries checked: ${report.entriesChecked}`,
    `ffprobe: ${report.ffprobeAvailable ? 'available' : 'not available'}`,
    `Errors: ${errors.length}`,
    `Warnings: ${warnings.length}`,
  ];

  for (const issue of report.issues) {
    lines.push(`[${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}`);
  }

  if (report.entriesChecked === 0) {
    lines.push(
      'No manifest entries yet. Add the first approved test video before generating the full exercise set.',
    );
  }

  return lines.join('\n');
}

export { summarizeValidationIssues };
