import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const PLACEHOLDER_PASSWORD_PATTERNS = [
  '[YOUR-PASSWORD]',
  'YOUR-PASSWORD',
  ':password@',
  ':your-password@',
];

function postgresUrlWithoutPlaceholder(name: string) {
  return z
    .string()
    .min(1, `${name} is required`)
    .refine((value) => !PLACEHOLDER_PASSWORD_PATTERNS.some((token) => value.toLowerCase().includes(token.toLowerCase())), {
      message: `${name} still contains a placeholder password. Replace [YOUR-PASSWORD] with the real Supabase database password.`,
    });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: postgresUrlWithoutPlaceholder('DATABASE_URL'),
  DIRECT_URL: postgresUrlWithoutPlaceholder('DIRECT_URL'),

  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  SUPABASE_BUCKET_PATIENT_IMAGES: z.string().min(1).default('patient-images'),
  SUPABASE_BUCKET_GENERATED_IMAGES: z.string().min(1).default('generated-images'),
  SUPABASE_BUCKET_MODELS: z.string().min(1).default('models'),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(604800).default(3600),

  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_ANALYSIS_MODEL: z.string().min(1).default('gemini-3.6-flash'),
  GEMINI_IMAGE_MODEL: z.string().min(1).default('gemini-2.5-flash-image'),
  GEMINI_VIDEO_MODEL: z.string().min(1).default('veo-3.1-fast-generate-preview'),
  GEMINI_VIDEO_POLL_INTERVAL_MS: z.coerce.number().int().min(2000).default(10_000),
  GEMINI_VIDEO_TIMEOUT_MS: z.coerce.number().int().min(30_000).default(600_000),
  // `auto` uploads via the Files API only when the inline request would exceed GEMINI_INLINE_BUDGET_BYTES.
  GEMINI_UPLOAD_MODE: z.enum(['auto', 'inline', 'files']).default('auto'),
  GEMINI_INLINE_BUDGET_BYTES: z.coerce.number().int().min(1).default(14_000_000),
  GEMINI_FILE_ACTIVE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(180_000),

  MESHY_ENABLED: booleanish.default(false),
  MESHY_API_KEY: z.string().min(1).optional(),
  MESHY_API_BASE_URL: z.string().url().default('https://api.meshy.ai'),
  MESHY_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
  MESHY_MAX_POLL_ATTEMPTS: z.coerce.number().int().min(1).default(120),
  // Meshy rejects rigging input above ~300k faces, so the generation stage must stay under it.
  MESHY_TARGET_POLYCOUNT: z.coerce.number().int().min(100).max(300_000).default(30_000),
  MESHY_RIG_HEIGHT_METERS: z.coerce.number().positive().max(10).default(1.7),
  // Prefer meshy-7 / latest for multi-view fidelity when the account supports it.
  MESHY_AI_MODEL: z.string().min(1).default('latest'),
  MESHY_TEXTURE_RESOLUTION: z.enum(['2k', '4k', '8k']).default('2k'),
  MESHY_ENABLE_PBR: booleanish.default(true),

  REFERENCE_MODEL_IMAGE_PATH: z.string().min(1).default('src/assets/reference-male-model.png'),

  CORS_ORIGIN: z.string().default(''),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
  TRUST_PROXY: booleanish.default(false),
});

export type RawEnv = z.infer<typeof envSchema>;

function parseEnv(): RawEnv {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

const parsed = parseEnv();

// Empty CORS_ORIGIN means "reflect no origin"; `*` allows any origin.
function parseCorsOrigins(value: string): string[] | '*' {
  const trimmed = value.trim();
  if (trimmed === '*') return '*';
  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export const env = {
  ...parsed,
  isProduction: parsed.NODE_ENV === 'production',
  meshyEnabled: parsed.MESHY_ENABLED && Boolean(parsed.MESHY_API_KEY?.trim()),
  corsOrigins: parseCorsOrigins(parsed.CORS_ORIGIN),
  referenceModelImageAbsolutePath: path.isAbsolute(parsed.REFERENCE_MODEL_IMAGE_PATH)
    ? parsed.REFERENCE_MODEL_IMAGE_PATH
    : path.resolve(process.cwd(), parsed.REFERENCE_MODEL_IMAGE_PATH),
} as const;

export type Env = typeof env;
