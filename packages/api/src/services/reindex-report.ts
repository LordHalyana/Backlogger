export interface SkippedFile {
  path: string;
  reason: string;
}

export function formatSkippedFiles(skipped: readonly SkippedFile[], limit = 8): string {
  if (skipped.length === 0) return '';
  const shown = skipped
    .slice(0, limit)
    .map((item) => `${item.path}: ${item.reason}`)
    .join('; ');
  const remaining = skipped.length - limit;
  return remaining > 0 ? `${shown}; ...and ${remaining} more` : shown;
}
