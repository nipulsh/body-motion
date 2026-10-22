import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

const nullableText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.literal(''), z.null()])
    .optional()
    .transform((value) => {
      if (value === '' || value === undefined) return null;
      return value;
    });

export const patientGenderSchema = z.enum(['male', 'female', 'other', 'unknown']);

export const patientFieldsSchema = z.strictObject({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must use YYYY-MM-DD format')
    .optional()
    .nullable(),
  gender: patientGenderSchema.optional().nullable(),
  phone: optionalText(40),
  email: z.union([z.string().trim().email().max(320), z.literal('')]).optional().nullable(),
  deformities: optionalText(4000),
  chronicConditions: optionalText(4000),
  notes: optionalText(8000),
});

/** Strict so a client-supplied `hospitalId` is rejected outright rather than silently ignored. */
export const createPatientBodySchema = patientFieldsSchema;

export const updatePatientBodySchema = z
  .strictObject({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    dateOfBirth: z
      .union([
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must use YYYY-MM-DD format'),
        z.literal(''),
        z.null(),
      ])
      .optional(),
    gender: z.union([patientGenderSchema, z.literal(''), z.null()]).optional(),
    phone: nullableText(40),
    email: z.union([z.string().trim().email().max(320), z.literal(''), z.null()]).optional(),
    deformities: nullableText(4000),
    chronicConditions: nullableText(4000),
    notes: nullableText(8000),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required.',
  });

export const listPatientsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
});

export type CreatePatientBody = z.infer<typeof createPatientBodySchema>;
export type UpdatePatientBody = z.infer<typeof updatePatientBodySchema>;

export function parseDateOfBirth(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid date of birth.');
  }
  return parsed;
}

export function normalizeCreatePatientBody(body: CreatePatientBody) {
  return {
    firstName: body.firstName,
    lastName: body.lastName,
    dateOfBirth: parseDateOfBirth(body.dateOfBirth ?? null),
    gender: body.gender ?? null,
    phone: body.phone ?? null,
    email: body.email && body.email !== '' ? body.email : null,
    deformities: body.deformities ?? null,
    chronicConditions: body.chronicConditions ?? null,
    notes: body.notes ?? null,
  };
}

export function normalizeUpdatePatientBody(body: UpdatePatientBody) {
  const data: Record<string, unknown> = {};
  if (body.firstName !== undefined) data.firstName = body.firstName;
  if (body.lastName !== undefined) data.lastName = body.lastName;
  if (body.dateOfBirth !== undefined) {
    data.dateOfBirth = body.dateOfBirth ? parseDateOfBirth(body.dateOfBirth) : null;
  }
  if (body.gender !== undefined) {
    data.gender = body.gender === '' ? null : body.gender;
  }
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.email !== undefined) data.email = body.email;
  if (body.deformities !== undefined) data.deformities = body.deformities;
  if (body.chronicConditions !== undefined) data.chronicConditions = body.chronicConditions;
  if (body.notes !== undefined) data.notes = body.notes;
  return data;
}
