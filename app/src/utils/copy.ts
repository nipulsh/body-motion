export function hedgedLikelihood(likelihood: number): string {
  if (likelihood >= 0.75) return 'More likely involved';
  if (likelihood >= 0.5) return 'Possibly involved';
  if (likelihood >= 0.35) return 'Less certain involvement';
  return 'Uncertain — consider clinical correlation';
}

export function formatJobStatusLabel(status: string): string {
  switch (status) {
    case 'QUEUED':
      return 'Queued';
    case 'ANALYZING':
      return 'Analyzing movement patterns';
    case 'GENERATING_IMAGES':
      return 'Generating reference views';
    case 'CREATING_3D_MODEL':
      return 'Building 3D body model';
    case 'RIGGING':
      return 'Rigging personalized avatar';
    case 'COMPLETED':
      return 'Complete';
    case 'FAILED':
      return 'Failed';
    default:
      return status.replace(/_/g, ' ').toLowerCase();
  }
}
