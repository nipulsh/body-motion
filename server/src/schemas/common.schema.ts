import { z } from 'zod';

export const patientIdParamSchema = z.object({
  patientId: z.uuid(),
});

export const jobIdParamSchema = z.object({
  jobId: z.uuid(),
});
