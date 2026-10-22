import { logger } from '../../utils/logger';
import { processAnalysisJob } from './jobPipeline.service';

const inFlight = new Set<string>();

export function enqueueAnalysisJob(jobId: string): void {
  if (inFlight.has(jobId)) {
    logger.warn('Job already running, skipping duplicate enqueue', { jobId });
    return;
  }

  inFlight.add(jobId);

  void processAnalysisJob(jobId)
    .catch((error: unknown) => {
      logger.error('Unhandled pipeline error', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      inFlight.delete(jobId);
    });
}
