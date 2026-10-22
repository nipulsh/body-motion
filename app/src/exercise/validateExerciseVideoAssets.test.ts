import { describe, expect, it } from 'vitest';
import {
  formatValidationReport,
  runExerciseVideoAssetValidation,
} from './validateExerciseVideoAssets';
import { summarizeValidationIssues } from './demoVideoValidation';

describe('runExerciseVideoAssetValidation', () => {
  it('passes when manifest has no bundled videos yet', async () => {
    const report = await runExerciseVideoAssetValidation();
    expect(report.entriesChecked).toBe(0);
    expect(summarizeValidationIssues(report.issues).errors).toHaveLength(0);
  });

  it('formats a readable validation report', async () => {
    const report = await runExerciseVideoAssetValidation();
    const output = formatValidationReport(report);
    expect(output).toContain('Exercise demo video validation');
    expect(output).toContain('manifest.json');
  });
});
