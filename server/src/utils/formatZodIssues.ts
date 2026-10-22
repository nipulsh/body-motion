import type { ZodError, ZodIssue } from 'zod';

export function formatZodIssue(issue: ZodIssue): Record<string, unknown> {
  const detail: Record<string, unknown> = {
    path: issue.path.join('.') || '(root)',
    code: issue.code,
    message: issue.message,
  };

  if (issue.code === 'invalid_type' && 'expected' in issue) {
    detail.expected = issue.expected;
    if ('input' in issue) {
      detail.received = issue.input;
    }
  }

  if (issue.code === 'invalid_value' && 'values' in issue) {
    detail.expected = issue.values;
    if ('input' in issue) {
      detail.received = issue.input;
    }
  }

  return detail;
}

export function formatZodIssues(error: ZodError): Record<string, unknown>[] {
  return error.issues.map(formatZodIssue);
}
