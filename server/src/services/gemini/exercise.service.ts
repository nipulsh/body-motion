import { createUserContent } from '@google/genai';
import { env } from '../../config/env';
import { geminiAnalysisSchema, type GeminiAnalysis } from '../../schemas/analysis.schema';
import { getGeminiExercisePlanJsonSchema } from '../../schemas/geminiExerciseResponse.schema';
import type { AnalysisResult, MuscleFinding } from '@prisma/client';
import { prismaSideToApi } from '../../utils/bodySide';
import {
  exercisePlanSchema,
  trackableJointSchema,
  type ExercisePlan,
} from '../../schemas/exercise.schema';
import { AppError } from '../../utils/AppError';
import { formatZodIssues } from '../../utils/formatZodIssues';
import { logger } from '../../utils/logger';
import { mapGeminiClientError } from './geminiError';
import { getGeminiClient } from './gemini.client';

export interface ExercisePatientContext {
  deformities?: string | null;
  chronicConditions?: string | null;
  notes?: string | null;
}

export interface ExerciseGenerationInput {
  analysis: GeminiAnalysis;
  patient?: ExercisePatientContext;
}

export function buildAnalysisInputFromResult(
  result: AnalysisResult & { muscleFindings: MuscleFinding[] },
): GeminiAnalysis {
  const parsed = geminiAnalysisSchema.safeParse(result.parsed);
  if (parsed.success) {
    return parsed.data;
  }

  return {
    bodyRegion: result.bodyRegion,
    observedDeformation: result.observedDeformation,
    affectedSide: prismaSideToApi(result.affectedSide),
    summary: result.summary,
    muscles: result.muscleFindings.map((muscle) => ({
      name: muscle.name,
      side: prismaSideToApi(muscle.side),
      likelihood: muscle.likelihood,
      deformation: muscle.deformation,
      intensity: muscle.intensity,
      reason: muscle.reason,
      contributionPercent: muscle.contributionPercent,
    })),
  };
}

const TRACKABLE_JOINTS = trackableJointSchema.options.join(', ');

function buildExerciseSystemPrompt(): string {
  return `You are a physiotherapy exercise planning assistant for a smart-mirror rehabilitation application.

IMPORTANT DISCLAIMERS — follow strictly:
- You are NOT providing a medical diagnosis or prescription.
- Exercises are AI-suggested and must be reviewed by a qualified clinician before use.
- Use cautious, patient-appropriate language in descriptions and safety notes.
- Tailor difficulty, reps, and safety notes to the observed muscular/postural findings.

OUTPUT RULES (critical):
- Return ONLY valid JSON matching the provided schema exactly.
- Generate exactly 5 or 6 exercises — no more, no fewer.
- Each exercise must have a unique lowercase "id" (e.g. "shoulder_flexion_march").
- "instructions" and "safetyNotes" must be arrays of concise strings.

TRACKING RULES (critical — used by computer vision for rep counting):
Each exercise must include at least one trackingRule with mathematically precise joint angles in degrees (0–180).

Allowed joint names (use exactly):
${TRACKABLE_JOINTS}

Angle conventions:
- Elbow: ~170° extended, ~90° flexed, ~45° deep flexion.
- Knee: ~170° standing, ~90° seated/squat midpoint.
- Shoulder abduction: measure arm elevation from torso using hip–shoulder–elbow angle; ~20° rest, ~90° horizontal, ~160° overhead.
- For shoulder abduction exercises:
  - Track ONLY the affected arm (left_shoulder OR right_shoulder — not both unless bilateral).
  - Use startAngle ~15–25, requiredAngle ~85–95, minimumAngle ~10, maximumAngle ~120.
  - Use tolerance ~10–15 and movement "abduction".
  - Include holdDurationSeconds: 1 for a brief pause at shoulder height.
  - startingPosition: "Arm resting at side" / targetPosition: "Arm at shoulder height".
  - Prefer id prefix "shoulder_abduction_" for the first shoulder abduction exercise in the plan.
- Hip flexion: ~170° standing, ~90° seated thigh horizontal.
- Spine/neck: approximate segment tilt; keep ranges conservative.

For each trackingRule provide:
- joint: one allowed joint name
- startAngle: angle at rep start
- requiredAngle: angle patient must reach at end of concentric phase
- minimumAngle / maximumAngle: acceptable range bracketing the movement
- tolerance: degrees of acceptable deviation from requiredAngle (typically 8–15)
- movement: flexion | extension | abduction | adduction | internal_rotation | external_rotation | elevation | depression
- startingPosition / targetPosition: short human-readable pose descriptions
- holdDurationSeconds: only when an isometric hold is required

Prioritize muscles and body regions identified in the analysis. Address observed asymmetry when affectedSide is left/right.`;
}

function buildExerciseUserPrompt(input: ExerciseGenerationInput): string {
  const { analysis, patient } = input;

  const muscleLines = analysis.muscles
    .map(
      (muscle) =>
        `- ${muscle.name} (${muscle.side}): deformation="${muscle.deformation}", ` +
        `likelihood=${muscle.likelihood.toFixed(2)}, intensity=${muscle.intensity.toFixed(2)}` +
        (muscle.contributionPercent !== undefined
          ? `, contribution=${muscle.contributionPercent.toFixed(1)}%`
          : '') +
        ` — ${muscle.reason}`,
    )
    .join('\n');

  const patientLines: string[] = [];
  if (patient?.deformities?.trim()) {
    patientLines.push(`Known deformities: ${patient.deformities.trim()}`);
  }
  if (patient?.chronicConditions?.trim()) {
    patientLines.push(`Chronic conditions: ${patient.chronicConditions.trim()}`);
  }
  if (patient?.notes?.trim()) {
    patientLines.push(`Clinical notes: ${patient.notes.trim()}`);
  }

  return [
    'Generate a personalized physiotherapy exercise plan from this body analysis.',
    '',
    `Body region: ${analysis.bodyRegion}`,
    `Observed deformation: ${analysis.observedDeformation}`,
    `Affected side: ${analysis.affectedSide}`,
    `Summary: ${analysis.summary}`,
    '',
    'Likely contributing muscles:',
    muscleLines,
    ...(patientLines.length > 0 ? ['', 'Patient context:', ...patientLines] : []),
    '',
    'Return 5–6 exercises as JSON matching the schema.',
  ].join('\n');
}

function parseGeminiExerciseResponse(text: string): ExercisePlan {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    throw new AppError('GEMINI_ERROR', 'Gemini returned non-JSON exercise output.', 502);
  }

  const result = exercisePlanSchema.safeParse(parsedJson);
  if (!result.success) {
    const formattedIssues = formatZodIssues(result.error);
    if (!env.isProduction) {
      console.error(
        '[Gemini Exercise Validation]',
        JSON.stringify(formattedIssues, null, 2),
      );
    }
    logger.warn('Gemini exercise response failed validation', {
      issueCount: formattedIssues.length,
      issues: formattedIssues,
    });
    throw AppError.validation('Gemini exercise response failed schema validation.', {
      issues: result.error.issues,
    });
  }

  return result.data;
}

export async function runGeminiExerciseGeneration(
  input: ExerciseGenerationInput,
): Promise<{ plan: ExercisePlan; modelName: string }> {
  const ai = getGeminiClient();
  const prompt = `${buildExerciseSystemPrompt()}\n\n${buildExerciseUserPrompt(input)}`;

  logger.info('Starting Gemini exercise generation', {
    bodyRegion: input.analysis.bodyRegion,
    muscleCount: input.analysis.muscles.length,
  });

  let response;
  try {
    response = await ai.models.generateContent({
      model: env.GEMINI_ANALYSIS_MODEL,
      contents: createUserContent([{ text: prompt }]),
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: getGeminiExercisePlanJsonSchema(),
      },
    });
  } catch (error) {
    logger.error('Gemini exercise generation request failed', {
      model: env.GEMINI_ANALYSIS_MODEL,
      bodyRegion: input.analysis.bodyRegion,
      errorName: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    throw mapGeminiClientError(error, 'Gemini exercise generation failed');
  }

  const text = response.text;
  if (!text) {
    throw new AppError('GEMINI_ERROR', 'Gemini returned an empty exercise response.', 502);
  }

  const plan = parseGeminiExerciseResponse(text);

  return {
    plan,
    modelName: env.GEMINI_ANALYSIS_MODEL,
  };
}
