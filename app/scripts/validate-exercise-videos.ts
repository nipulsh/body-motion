/**
 * Validate bundled exercise demonstration videos against manifest.json.
 *
 * Usage (from app/):
 *   npm run validate:exercise-videos
 */
import {
  formatValidationReport,
  runExerciseVideoAssetValidation,
  summarizeValidationIssues,
} from '../src/exercise/validateExerciseVideoAssets';

const report = await runExerciseVideoAssetValidation();
console.log(formatValidationReport(report));

const { errors } = summarizeValidationIssues(report.issues);
if (errors.length > 0) {
  process.exitCode = 1;
}
