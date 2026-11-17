import { createPartFromUri, createUserContent, type Part } from '@google/genai';
import { toJSONSchema } from 'zod';
import { env } from '../../config/env';
import {
  listCatalogueMuscleNames,
  lookupMuscle,
  lookupMuscleGroup,
} from '../../config/muscleMap';
import {
  bodyRegionSchema,
  geminiAnalysisResponseSchema,
  type Deformity,
  type GeminiAnalysis,
  type GeminiAnalysisResponse,
} from '../../schemas/analysis.schema';
import type { PostureFinding, PostureMetrics } from '../../schemas/posture.schema';
import { mergeDuplicateMuscles, normaliseContributions } from '../../utils/muscleContribution';
import type { Prisma } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { toInputJson } from '../../utils/json';
import { logger } from '../../utils/logger';
import { sleep } from '../../utils/sleep';
import { getGeminiClient } from './gemini.client';

export interface PatientImageInput {
  buffer: Buffer;
  mimeType: string;
  label: string;
}

const BODY_REGIONS = bodyRegionSchema.options.join(', ');

/** Stored as the region and the deformation when a capture could not be analysed. */
const NOT_ASSESSED = 'Not assessed';

/**
 * The posture section of the prompt. Built only from server-derived findings (see
 * postureMetricRules) and numbers, never from client-written text.
 */
export function describePosture(posture: PostureMetrics | null): string {
  if (!posture || posture.frameCount === 0) {
    return `OBJECTIVE POSE MEASUREMENTS: none available for this capture. Rely on the images, and still assess every region below.`;
  }
  const unit = (u: 'deg' | 'percent') => (u === 'deg' ? '°' : '%');
  const findings =
    posture.findings.length > 0
      ? posture.findings
          .map(
            (f, i) =>
              `${i + 1}. [${f.region}, ${f.side}] ${f.description} — ${f.value}${unit(f.unit)} ` +
              `(screening threshold ${f.threshold}${unit(f.unit)}, severity x${f.severity.toFixed(2)}; ` +
              `acting muscle groups: ${f.muscleGroups.join(', ')})`,
          )
          .join('\n')
      : 'No measurement exceeded its screening threshold.';
  const metrics = Object.entries(posture.metrics)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  return `OBJECTIVE POSE MEASUREMENTS (MediaPipe landmarks on ${posture.frameCount} of these frames; ${posture.frontalFrames} front-on, ${posture.sideFrames} side-on).
Angles are joint angles or are measured against the body's own vertical (perpendicular to the feet), so camera tilt does not affect them. Signed values: positive = patient's LEFT.
Deviations above threshold, most pronounced first:
${findings}
All medians: ${metrics}`;
}

function buildAnalysisSystemPrompt(posture: PostureMetrics | null): string {
  const catalogue = listCatalogueMuscleNames().join(', ');
  return `You are an AI assistant helping clinicians explore possible muscular contributors to observed body posture and shape changes.

IMPORTANT DISCLAIMERS — follow strictly:
- You are NOT providing a medical diagnosis.
- Use language such as "likely contributing muscle", "possible contributing muscle", "observed deformation", and "AI-estimated likelihood".
- Never claim medical proof or certainty about causation.
- Analyse all supplied images together as one capture session of the same person.

${describePosture(posture)}

FIRST, DECIDE WHETHER THIS CAPTURE CAN BE ANALYSED. Set "analysisPossible" before anything else.
Set it to false when the body's shape and alignment cannot be judged reliably, for example:
- loose, bulky or draped clothing hides the outline of the trunk, hips or legs (coats, robes, sarees, long skirts, oversized shirts or hoodies);
- the body is mostly out of frame, or blocked by objects or another person;
- the images are too dark, overexposed or blurred to see the body's outline;
- no person is visible.
Ordinary fitted clothing is NOT a reason. The pose measurements above do not rescue a capture whose body shape you cannot see, because landmarks placed through bulky clothing are unreliable.
When "analysisPossible" is false, do NOT analyse and do NOT guess:
- "summary": plainly say what stopped the analysis and what to change for the next scan, e.g. "The analysis could not be completed because a loose jacket hides the shape of the trunk and hips. Please scan again in fitted clothing."
- "regionAssessment", "deformities" and "muscles": empty arrays.
- "bodyRegion" and "observedDeformation": exactly "${NOT_ASSESSED}". "affectedSide": "unknown".
When only part of the body is hidden and the rest is clear, set it to true and analyse what can be seen. For each hidden region use severity 0 with the observation "Not assessable: <reason>", list no deformity or muscle for it, and name those regions in "summary".

METHOD when the capture can be analysed (mandatory, in this order):
1. Head-to-toe assessment. Fill "regionAssessment" with one entry for EVERY region in this list: ${BODY_REGIONS}.
   For each, look at the images (and the measurements above) and rate severity 0-1 with a concrete observation. Use severity 0 and "no notable deviation" when normal. Do not skip the legs, knees or feet.
2. Every deformity. Fill "deformities" with EVERY postural deviation or body-shape change you found, not only the main one: one entry each, with a short "name" (e.g. "Right shoulder drop", "Left knee valgus"), "region", "side", "severity" 0-1 and a concrete "description". A region with two deformities gets two entries. Every region rated above 0 in step 1 and every measurement above threshold MUST appear here. Most pronounced first. "summary" must mention all of them.
3. Pick the primary problem from the evidence, not from habit: "bodyRegion" is the region with the strongest deviation in step 1.
   Objective measurements outrank visual impressions. When a measurement is above threshold (e.g. one knee held bent, a pelvis drop, a valgus knee), that region MUST be rated accordingly and reflected in bodyRegion/observedDeformation unless the images clearly contradict it.
   Do NOT default to the shoulders or upper body. A bent or misaligned leg is a lower-limb finding (knee/thigh/lower_leg_ankle/pelvis_hip), and its muscles are lower-limb muscles.
4. Muscles. Return EVERY muscle that plausibly contributes to the deviations found. There is no upper limit and no fixed count: typically 6-20 when several regions deviate. Include both the shortened/overactive and the lengthened/weak side of each pattern, and contralateral or compensating muscles when the measurements suggest them. Only list muscles for regions you rated above 0.
   For each muscle give: "region" (one of the regions above that it explains), deformation type, likelihood (0-1), intensity (0-1), a brief reason that cites the observation or measurement, and "contributionPercent": the share of the overall postural deformity you attribute to that muscle.
   The contributionPercent values of all muscles MUST add up to 100. Weight them by how strongly each muscle explains the most severe deviations.

MUSCLE NAMING (critical):
- Every muscle "name" you return MUST match an entry from this BodyParts3D catalogue exactly (including Left/Right prefix when present):
${catalogue}
- Prefer the most specific catalogue name that explains the observed deformation (e.g. "Left Biceps Femoris" not a vague regional label).
- If several heads/parts of one muscle are implicated, still return the catalogue muscle name; the app maps it to mesh components.
- Do not invent muscle names outside the catalogue.

Identify:
- body region affected (primary), observed deformation (neutral, descriptive terms; be concrete about asymmetry, flexion, tilt, valgus/varus, atrophy, hypertrophy, winging, etc.)
- affected side (left, right, bilateral, midline, or unknown)

Return JSON matching the provided schema exactly.`;
}

function buildImageParts(images: PatientImageInput[], promptText: string): Part[] {
  const parts: Part[] = [
    {
      text: `${promptText}\n\n` + `Analyse the following ${images.length} images together.`,
    },
  ];

  for (const image of images) {
    parts.push({ text: image.label });
    parts.push({
      inlineData: {
        data: image.buffer.toString('base64'),
        mimeType: image.mimeType,
      },
    });
  }

  return parts;
}

function estimateInlineBytes(images: PatientImageInput[]): number {
  return images.reduce((sum, image) => sum + image.buffer.length, 0);
}

async function waitForFileActive(fileName: string): Promise<{ uri: string; mimeType: string }> {
  const ai = getGeminiClient();
  const deadline = Date.now() + env.GEMINI_FILE_ACTIVE_TIMEOUT_MS;

  let current = await ai.files.get({ name: fileName });

  while (current.state !== 'ACTIVE') {
    if (current.state === 'FAILED') {
      throw new AppError(
        'GEMINI_ERROR',
        `Gemini file processing failed: ${current.error?.message ?? 'unknown error'}`,
        502,
      );
    }
    if (Date.now() >= deadline) {
      throw new AppError('GEMINI_ERROR', 'Timed out waiting for Gemini file to become ACTIVE.', 504);
    }
    await sleep(1000);
    current = await ai.files.get({ name: fileName });
  }

  if (!current.uri || !current.mimeType) {
    throw new AppError('GEMINI_ERROR', 'Gemini file is ACTIVE but missing uri or mimeType.', 502);
  }

  return { uri: current.uri, mimeType: current.mimeType };
}

async function buildFileApiParts(images: PatientImageInput[], promptText: string): Promise<Part[]> {
  const ai = getGeminiClient();
  const uploaded: Array<{ label: string; uri: string; mimeType: string }> = [];

  for (const image of images) {
    const file = await ai.files.upload({
      file: new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
      config: { mimeType: image.mimeType, displayName: image.label },
    });

    if (!file.name) {
      throw new AppError('GEMINI_ERROR', 'Gemini file upload did not return a resource name.', 502);
    }

    const active = await waitForFileActive(file.name);
    uploaded.push({ label: image.label, uri: active.uri, mimeType: active.mimeType });
  }

  const parts: Part[] = [
    {
      text: `${promptText}\n\n` + `Analyse the following ${images.length} images together.`,
    },
  ];

  for (const item of uploaded) {
    parts.push({ text: item.label });
    parts.push(createPartFromUri(item.uri, item.mimeType));
  }

  return parts;
}

function resolveUploadMode(images: PatientImageInput[]): 'inline' | 'files' {
  if (env.GEMINI_UPLOAD_MODE === 'inline') return 'inline';
  if (env.GEMINI_UPLOAD_MODE === 'files') return 'files';
  return estimateInlineBytes(images) > env.GEMINI_INLINE_BUDGET_BYTES ? 'files' : 'inline';
}

export interface AnalysisRunResult {
  parsed: GeminiAnalysis;
  rawResponse: Prisma.InputJsonValue;
  modelName: string;
  /** Sorted by contributionPercent, highest first; contributions sum to 100. */
  enrichedMuscles: Array<
    GeminiAnalysis['muscles'][number] & {
      contributionPercent: number;
      bodyExplorerId: string;
      bodyExplorerMeshNames: string[];
    }
  >;
}

/**
 * The strongest measured deviation, when it is pronounced enough that an analysis ignoring it
 * is almost certainly looking at the wrong body part.
 */
export function dominantPostureFinding(posture: PostureMetrics | null): PostureFinding | null {
  const top = posture?.findings[0];
  return top && top.severity >= 1.5 ? top : null;
}

/** True when at least one returned muscle acts on the region of the given measured deviation. */
/** Head-to-toe regions (analysis schema) that cover each measured posture region. */
const FINDING_REGIONS: Record<PostureFinding['region'], readonly string[]> = {
  head_neck: ['head_neck'],
  shoulder: ['shoulder', 'upper_back'],
  elbow: ['upper_arm_elbow', 'forearm_hand'],
  trunk: ['upper_back', 'lower_back', 'abdomen', 'chest'],
  pelvis_hip: ['pelvis_hip', 'lower_back', 'thigh'],
  knee: ['knee', 'thigh', 'lower_leg_ankle'],
  leg: ['pelvis_hip', 'thigh', 'knee', 'lower_leg_ankle', 'foot'],
};

/** A rating this low means the model considered the region normal. */
const MIN_REGION_RATING = 0.2;

/**
 * Words that show the stated primary bodyRegion (free text) is about a measured region.
 * Kept broad on purpose: "leg" or "lower limb" counts for a knee finding.
 */
const FINDING_REGION_WORDS: Record<PostureFinding['region'], readonly string[]> = {
  head_neck: ['head', 'neck', 'cervical'],
  shoulder: ['shoulder', 'scapula', 'scapular'],
  elbow: ['elbow', 'arm', 'forearm'],
  trunk: ['trunk', 'spine', 'spinal', 'back', 'thoracic', 'lumbar', 'torso', 'abdomen'],
  pelvis_hip: ['pelvis', 'pelvic', 'hip'],
  knee: ['knee', 'leg', 'thigh', 'lower limb'],
  leg: ['leg', 'lower limb', 'hip', 'knee', 'ankle', 'foot'],
};

/**
 * When the stated primary region is somewhere else, the measured region must still be rated
 * at least moderately (0.4 on the prompt's 0 = normal … 1 = pronounced scale). The dominant
 * finding is ≥1.5x its screening threshold, so rating it below that while naming another
 * region dismisses it.
 */
const MIN_RATING_WHEN_NOT_PRIMARY = 0.4;

export interface AnswerForGuard {
  bodyRegion?: string;
  muscles: Array<{ name: string; side: string }>;
  regionAssessment?: Array<{ region: string; severity: number }>;
}

function sideCompatible(findingSide: PostureFinding['side'], muscle: { name: string; side: string }): boolean {
  if (findingSide !== 'left' && findingSide !== 'right') return true;
  const opposite = findingSide === 'left' ? 'right' : 'left';
  if (muscle.side === opposite) return false;
  return !muscle.name.trim().toLowerCase().startsWith(`${opposite} `);
}

/**
 * True when the answer actually covers the measured deviation: it rates one of the matching
 * head-to-toe regions above normal, and lists a muscle from an acting group on a compatible side.
 */
export function addressesFinding(answer: AnswerForGuard, finding: PostureFinding): boolean {
  const regions = new Set(FINDING_REGIONS[finding.region]);
  const primary = (answer.bodyRegion ?? '').toLowerCase();
  const primaryIsMeasured = FINDING_REGION_WORDS[finding.region].some((word) =>
    new RegExp(`\\b${word}`).test(primary),
  );
  const minRating = primaryIsMeasured ? MIN_REGION_RATING : MIN_RATING_WHEN_NOT_PRIMARY;
  const rated = (answer.regionAssessment ?? []).some(
    (entry) => regions.has(entry.region) && entry.severity >= minRating,
  );
  if (!rated) return false;
  const groups = new Set<string>(finding.muscleGroups);
  return answer.muscles.some((muscle) => {
    const group = lookupMuscleGroup(muscle.name);
    return group !== null && groups.has(group) && sideCompatible(finding.side, muscle);
  });
}

/** A measured deviation this far past its screening threshold counts as a pronounced deformity. */
const FULL_SEVERITY_RATIO = 3;

/**
 * Every deformity, whatever the model chose to list: a region it rated above normal and a measured
 * deviation it left out are both added, so nothing it found or the camera measured goes unshown.
 */
export function completeDeformities(
  answer: Pick<GeminiAnalysisResponse, 'deformities' | 'regionAssessment'>,
  posture: PostureMetrics | null,
): Deformity[] {
  const all = [...answer.deformities];
  for (const entry of answer.regionAssessment) {
    if (entry.severity <= 0 || all.some((deformity) => deformity.region === entry.region)) continue;
    all.push({
      name: entry.observation,
      region: entry.region,
      side: entry.side,
      severity: entry.severity,
      description: entry.observation,
    });
  }
  const unit = (u: 'deg' | 'percent') => (u === 'deg' ? '°' : '%');
  for (const finding of posture?.findings ?? []) {
    const regions = FINDING_REGIONS[finding.region];
    const covered = all.some(
      (deformity) =>
        regions.includes(deformity.region) &&
        (deformity.side === finding.side || deformity.side === 'bilateral' || finding.side === 'bilateral'),
    );
    if (covered) continue;
    all.push({
      name: finding.description,
      region: bodyRegionSchema.parse(regions[0]),
      side: finding.side,
      severity: Math.min(1, finding.severity / FULL_SEVERITY_RATIO),
      description: `Measured ${finding.value}${unit(finding.unit)}, screening threshold ${finding.threshold}${unit(finding.unit)}.`,
    });
  }
  return all.sort((a, b) => b.severity - a.severity);
}

/** The stored form of a capture that could not be analysed. Only the summary comes from the model. */
function notAnalysed(summary: string): GeminiAnalysis {
  return {
    analysisPossible: false,
    regionAssessment: [],
    deformities: [],
    bodyRegion: NOT_ASSESSED,
    observedDeformation: NOT_ASSESSED,
    affectedSide: 'unknown',
    summary,
    muscles: [],
  };
}

/**
 * Response schema sent to Gemini: the analysis schema with muscle names constrained to the
 * catalogue, so names are enforced at generation time at no extra cost. The zod schema stays
 * lenient; `validateMuscleNames` still checks every name server-side.
 */
export function buildResponseJsonSchema(): Record<string, unknown> {
  const schema = toJSONSchema(geminiAnalysisResponseSchema) as unknown as {
    properties: { muscles: { items: { properties: { name: Record<string, unknown> } } } };
  };
  schema.properties.muscles.items.properties.name = {
    ...schema.properties.muscles.items.properties.name,
    enum: listCatalogueMuscleNames(),
  };
  return schema as unknown as Record<string, unknown>;
}

/** Split muscles into catalogue matches (exact, no fuzzy guessing) and unknown names. */
export function validateMuscleNames<T extends { name: string }>(muscles: T[]): { valid: T[]; invalid: string[] } {
  const valid: T[] = [];
  const invalid: string[] = [];
  for (const muscle of muscles) {
    if (lookupMuscle(muscle.name, { fuzzy: false })) valid.push(muscle);
    else invalid.push(muscle.name);
  }
  return { valid, invalid };
}

async function requestAnalysis(
  images: PatientImageInput[],
  uploadMode: 'inline' | 'files',
  promptText: string,
) {
  const ai = getGeminiClient();
  const parts =
    uploadMode === 'files'
      ? await buildFileApiParts(images, promptText)
      : buildImageParts(images, promptText);

  const response = await ai.models.generateContent({
    model: env.GEMINI_ANALYSIS_MODEL,
    contents: createUserContent(parts),
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: buildResponseJsonSchema(),
    },
  });

  const text = response.text;
  if (!text) {
    throw new AppError('GEMINI_ERROR', 'Gemini returned an empty analysis response.', 502);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    throw new AppError('GEMINI_ERROR', 'Gemini returned non-JSON analysis output.', 502);
  }

  const parsed: GeminiAnalysisResponse = geminiAnalysisResponseSchema.parse(parsedJson);
  return { parsed, text, response };
}

export async function runGeminiAnalysis(
  images: PatientImageInput[],
  posture: PostureMetrics | null = null,
): Promise<AnalysisRunResult> {
  const uploadMode = resolveUploadMode(images);
  logger.info('Starting Gemini analysis', {
    imageCount: images.length,
    uploadMode,
    postureFindings: posture?.findings.length ?? 0,
  });

  const basePrompt = buildAnalysisSystemPrompt(posture);
  let attempt = await requestAnalysis(images, uploadMode, basePrompt);

  // Guard against the model fixating on the wrong body part: if a clearly measured deviation
  // has no muscle acting on it, ask once more with that called out explicitly.
  const dominant = dominantPostureFinding(posture);
  let measurementConflict: string | undefined;
  if (attempt.parsed.analysisPossible && dominant && !addressesFinding(attempt.parsed, dominant)) {
    logger.warn('Gemini analysis ignored the dominant measured deviation; re-requesting', {
      finding: dominant.metric,
      bodyRegion: attempt.parsed.bodyRegion,
    });
    const correction =
      `\n\nCORRECTION REQUIRED: a previous answer for these images named "${attempt.parsed.bodyRegion}" ` +
      `and listed no muscle acting on the most pronounced MEASURED deviation: "${dominant.description}" ` +
      `(${dominant.region}, ${dominant.side}; muscle groups ${dominant.muscleGroups.join(', ')}). ` +
      `Re-assess from head to toe and make sure this deviation and its muscles are covered.`;
    attempt = await requestAnalysis(images, uploadMode, basePrompt + correction);
    if (attempt.parsed.analysisPossible && !addressesFinding(attempt.parsed, dominant)) {
      // Still ignored after a direct correction: keep the answer but say so where clinicians read it.
      measurementConflict =
        `The AI analysis did not account for a measured deviation: ${dominant.description} ` +
        `(${dominant.region}, ${dominant.side}). Review this region clinically.`;
      logger.warn('Gemini analysis still ignores the dominant measured deviation after retry', {
        finding: dominant.metric,
      });
    }
  }

  const { parsed, text, response } = attempt;

  const rawResponse = toInputJson({
    model: env.GEMINI_ANALYSIS_MODEL,
    uploadMode,
    candidates: response.candidates,
    usageMetadata: response.usageMetadata,
    parsedText: text,
    postureMetrics: posture,
  });

  if (!parsed.analysisPossible) {
    logger.info('Gemini could not analyse this capture', { imageCount: images.length });
    return {
      parsed: notAnalysed(parsed.summary),
      rawResponse,
      modelName: env.GEMINI_ANALYSIS_MODEL,
      enrichedMuscles: [],
    };
  }

  // Names outside the catalogue cannot be shown or reasoned about; drop and record them.
  const { valid, invalid } = validateMuscleNames(parsed.muscles);
  // No muscles at all is an honest answer for a body with no deviation; only unusable names are an error.
  if (valid.length === 0 && invalid.length > 0) {
    throw new AppError(
      'GEMINI_ERROR',
      `Gemini returned no muscle names from the catalogue (got: ${invalid.slice(0, 5).join(', ')}).`,
      502,
    );
  }
  if (invalid.length > 0) {
    logger.warn('Dropped muscle names outside the catalogue', { invalid });
  }

  const resolvedMuscles = valid.map((muscle) => {
    const resolved = lookupMuscle(muscle.name, { fuzzy: false });
    return {
      ...muscle,
      // Prefer catalogue / component name so the UI and 3D viewer share one vocabulary.
      name: resolved?.catalogueName ?? muscle.name,
      bodyExplorerId: resolved?.bodyExplorerId ?? '',
      bodyExplorerMeshNames: resolved?.bodyExplorerMeshNames ?? [],
    };
  });
  // Two names can resolve to one catalogue muscle, and the model sometimes repeats a muscle.
  const enrichedMuscles =
    resolvedMuscles.length > 0 ? normaliseContributions(mergeDuplicateMuscles(resolvedMuscles)) : [];

  const remappedParsed: GeminiAnalysis = {
    analysisPossible: true,
    regionAssessment: parsed.regionAssessment,
    deformities: completeDeformities(parsed, posture),
    bodyRegion: parsed.bodyRegion,
    observedDeformation: parsed.observedDeformation,
    affectedSide: parsed.affectedSide,
    summary: parsed.summary,
    ...(measurementConflict ? { measurementConflict } : {}),
    ...(invalid.length > 0 ? { invalidMuscleNames: invalid } : {}),
    muscles: enrichedMuscles.map((muscle) => ({
      name: muscle.name,
      side: muscle.side,
      likelihood: muscle.likelihood,
      deformation: muscle.deformation,
      intensity: muscle.intensity,
      reason: muscle.reason,
      region: muscle.region,
      contributionPercent: muscle.contributionPercent,
    })),
  };

  return {
    parsed: remappedParsed,
    rawResponse,
    modelName: env.GEMINI_ANALYSIS_MODEL,
    enrichedMuscles,
  };
}
