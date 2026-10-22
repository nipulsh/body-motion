import { z } from 'zod';

export const scanIdParamSchema = z.object({
  scanId: z.uuid(),
});

export const createScanBodySchema = z.strictObject({
  type: z.enum(['BODY_360', 'TIMED_BURST']).optional(),
});

export type CreateScanBody = z.infer<typeof createScanBodySchema>;
