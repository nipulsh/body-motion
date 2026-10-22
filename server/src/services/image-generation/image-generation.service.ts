import type { Part } from '@google/genai';
import type { GeneratedImageView } from '@prisma/client';
import { GENERATED_IMAGE_VIEWS } from '../../config/constants';
import { env } from '../../config/env';
import type { GeminiAnalysis } from '../../schemas/analysis.schema';
import { AppError } from '../../utils/AppError';
import { assertNever } from '../../utils/exhaustive';
import { logger } from '../../utils/logger';
import { getGeminiClient } from '../gemini/gemini.client';
import type { ReferenceImage } from '../reference-image.service';

const VIEW_INSTRUCTIONS: Record<GeneratedImageView, string> = {
  FRONT: 'front view, camera facing the subject directly',
  RIGHT: 'right side profile view (subject\'s right side toward camera)',
  BACK: 'back view, camera behind the subject',
  LEFT: 'left side profile view (subject\'s left side toward camera)',
};

export interface PatientDeformityReference {
  buffer: Buffer;
  mimeType: string;
  label: string;
}

/** Index into the original image list, plus the label the reference selector would assign. */
export interface PatientReferencePick {
  index: number;
  label: string;
}

function buildGenerationPrompt(
  analysis: GeminiAnalysis,
  view: GeneratedImageView,
  hasFrontAnchor: boolean,
  patientRefCount: number,
): string {
  const muscleSummary = analysis.muscles
    .map(
      (m) =>
        `${m.name} (${m.side}): ${m.deformation}, likelihood ${m.likelihood.toFixed(2)}, intensity ${m.intensity.toFixed(2)}`,
    )
    .join('; ');

  const patientGuidance =
    patientRefCount > 0
      ? [
          `The next ${patientRefCount} attached image(s) are REAL patient scan photos from this session.`,
          'These patient photos are the SOURCE OF TRUTH for body deformity, asymmetry, posture, and contour.',
          'Faithfully reproduce the SAME visible deformity, asymmetry, lean, atrophy/hypertrophy, scapular winging, pelvic tilt, or contour change seen in the patient photos.',
          'Do NOT invent a different deformity. Do NOT symmetrize or “correct” the body. Do NOT make the deformity subtle if the photos show a clear change.',
          'Match severity and side (left/right) of the deformity as closely as the photos allow.',
        ]
      : [
          'No patient scan photos were available; still render the described deformity clearly and asymmetrically when the analysis indicates a sided change.',
        ];

  return [
    'Generate a single full-body anatomical reference image of a common adult male human model.',
    'This is NOT a photograph of a real patient — it is a neutral reference render for 3D reconstruction.',
    `Camera / view: ${VIEW_INSTRUCTIONS[view]}.`,
    'The first attached image is the common reference model. Match it for body proportions, build, skin tone, clothing-free silhouette style, and neutral standing pose framing.',
    ...patientGuidance,
    hasFrontAnchor
      ? 'The last attached image is the already-generated front view of this exact subject. It is the identity/consistency anchor: reproduce the same person, identical body proportions, identical build and skin tone, identical lighting and background, and the IDENTICAL deformity, seen from the new camera angle.'
      : 'This front view establishes the subject that the remaining three views must match exactly — including the exact deformity.',
    `Body region with observed deformation: ${analysis.bodyRegion}.`,
    `Observed deformation (must be clearly visible in the image): ${analysis.observedDeformation}.`,
    `Affected side: ${analysis.affectedSide}.`,
    `Likely contributing muscles (AI-estimated, not diagnostic): ${muscleSummary}.`,
    'PRIORITY: exact visual replication of the patient deformity in this anatomical reference. Clarity of the deformity matters more than cosmetic “normal” anatomy.',
    'Keep the subject centred, upright, full-body in frame, at the same scale and distance in every view.',
    'Requirements: plain neutral background, consistent lighting, no text, no watermark, no extra limbs, single person only.',
    'Output one image only.',
  ].join('\n');
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      return 'png';
  }
}

export interface GeneratedViewImage {
  view: GeneratedImageView;
  buffer: Buffer;
  mimeType: string;
  extension: string;
  prompt: string;
}

/** Evenly sample sequential frames (timed burst / video strip), ignoring rotation angles. */
export function planSequencePatientReferences(
  images: ReadonlyArray<{ orderIndex?: number }>,
  max = 2,
): PatientReferencePick[] {
  if (images.length === 0 || max <= 0) return [];

  const sorted = images
    .map((image, index) => ({ image, index }))
    .sort((a, b) => (a.image.orderIndex ?? 0) - (b.image.orderIndex ?? 0));
  const picks: number[] = [];
  if (sorted.length === 1) {
    picks.push(0);
  } else {
    for (let i = 0; i < max; i += 1) {
      picks.push(Math.round((i * (sorted.length - 1)) / Math.max(max - 1, 1)));
    }
  }
  const unique = [...new Set(picks)].slice(0, max);
  return unique.map((sortedIndex, i) => {
    const entry = sorted[sortedIndex]!;
    const frame = entry.image.orderIndex ?? sortedIndex;
    return {
      index: entry.index,
      label: `Patient scan reference ${i + 1} (frame ${frame + 1}/${sorted.length})`,
    };
  });
}

export function selectSequencePatientReferences(
  images: Array<{ buffer: Buffer; mimeType: string; orderIndex?: number }>,
  max = 2,
): PatientDeformityReference[] {
  return planSequencePatientReferences(images, max).map((pick) => {
    const image = images[pick.index]!;
    return {
      buffer: image.buffer,
      mimeType: image.mimeType,
      label: pick.label,
    };
  });
}

/**
 * Pick up to `max` patient images that best cover front / side / back by angle when available.
 * Gemini image models work best with a small number of conditioning images.
 */
export function planPatientDeformityReferences(
  images: ReadonlyArray<{ angle?: string | null; orderIndex?: number }>,
  max = 2,
): PatientReferencePick[] {
  if (images.length === 0 || max <= 0) return [];

  const withAngles = images
    .map((image, index) => ({ index, angle: parseAngle(image.angle) }))
    .filter((item) => item.angle != null);

  if (withAngles.length === 0) {
    // No angles stored — sample evenly across the capture sequence.
    const picks: number[] = [];
    if (images.length === 1) {
      picks.push(0);
    } else {
      for (let i = 0; i < max; i += 1) {
        picks.push(Math.round((i * (images.length - 1)) / Math.max(max - 1, 1)));
      }
    }
    const unique = [...new Set(picks)].slice(0, max);
    return unique.map((index, i) => ({
      index,
      label: `Patient scan reference ${i + 1} (frame ${index + 1}/${images.length})`,
    }));
  }

  const scored = withAngles.map((item) => {
    const angle = item.angle!;
    const front = circularDistance(angle, 0);
    const right = circularDistance(angle, 90);
    const back = circularDistance(angle, 180);
    const best = Math.min(front, right, back);
    return { ...item, score: best };
  });

  scored.sort((a, b) => a.score - b.score || a.index - b.index);

  const picked: typeof scored = [];
  const usedBuckets = new Set<string>();
  for (const item of scored) {
    const angle = item.angle!;
    const bucket =
      circularDistance(angle, 0) <= 30
        ? 'front'
        : circularDistance(angle, 90) <= 30 || circularDistance(angle, 270) <= 30
          ? 'side'
          : circularDistance(angle, 180) <= 30
            ? 'back'
            : `other-${item.index}`;
    if (usedBuckets.has(bucket) && picked.length > 0) continue;
    usedBuckets.add(bucket);
    picked.push(item);
    if (picked.length >= max) break;
  }

  return picked.map((item, i) => ({
    index: item.index,
    label: `Patient scan reference ${i + 1} (~${Math.round(item.angle!)}°)`,
  }));
}

export function selectPatientDeformityReferences(
  images: Array<{ buffer: Buffer; mimeType: string; angle?: string | null; orderIndex?: number }>,
  max = 2,
): PatientDeformityReference[] {
  return planPatientDeformityReferences(images, max).map((pick) => {
    const image = images[pick.index]!;
    return {
      buffer: image.buffer,
      mimeType: image.mimeType,
      label: pick.label,
    };
  });
}

function parseAngle(angle: string | null | undefined): number | null {
  if (angle == null || angle === '') return null;
  const n = Number.parseFloat(angle);
  return Number.isFinite(n) ? ((n % 360) + 360) % 360 : null;
}

function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

export async function generateReferenceImages(
  analysis: GeminiAnalysis,
  reference: ReferenceImage,
  patientReferences: PatientDeformityReference[] = [],
): Promise<GeneratedViewImage[]> {
  const ai = getGeminiClient();
  const results: GeneratedViewImage[] = [];

  // gemini-2.5-flash-image works best with a small set of input images, so each view is
  // conditioned on: common reference + patient deformity refs + already-generated front.
  let frontAnchor: GeneratedViewImage | null = null;

  for (const view of GENERATED_IMAGE_VIEWS) {
    const prompt = buildGenerationPrompt(
      analysis,
      view,
      frontAnchor !== null,
      patientReferences.length,
    );
    const parts: Part[] = [
      { text: prompt },
      {
        inlineData: {
          data: reference.buffer.toString('base64'),
          mimeType: reference.mimeType,
        },
      },
    ];

    for (const patient of patientReferences) {
      parts.push({ text: patient.label });
      parts.push({
        inlineData: {
          data: patient.buffer.toString('base64'),
          mimeType: patient.mimeType,
        },
      });
    }

    if (frontAnchor) {
      parts.push({
        inlineData: {
          data: frontAnchor.buffer.toString('base64'),
          mimeType: frontAnchor.mimeType,
        },
      });
    }

    logger.info('Generating reference image', {
      view,
      model: env.GEMINI_IMAGE_MODEL,
      patientRefCount: patientReferences.length,
    });

    const response = await ai.models.generateContent({
      model: env.GEMINI_IMAGE_MODEL,
      contents: parts,
    });

    const candidateParts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = candidateParts.find((part) => part.inlineData?.data);

    if (!imagePart?.inlineData?.data) {
      throw new AppError(
        'IMAGE_GENERATION_ERROR',
        `Gemini did not return an image for view ${view}.`,
        502,
      );
    }

    const mimeType = imagePart.inlineData.mimeType ?? 'image/png';
    const generated: GeneratedViewImage = {
      view,
      buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
      mimeType,
      extension: extensionForMime(mimeType),
      prompt,
    };

    results.push(generated);
    if (view === 'FRONT') {
      frontAnchor = generated;
    }
  }

  return results;
}

export function viewLabel(view: GeneratedImageView): string {
  switch (view) {
    case 'FRONT':
      return 'front';
    case 'RIGHT':
      return 'right';
    case 'BACK':
      return 'back';
    case 'LEFT':
      return 'left';
    default:
      return assertNever(view);
  }
}
