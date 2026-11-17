import { useAppAuth } from '../../auth/AppAuthContext';
import type { Exercise } from '@vision';
import { Dumbbell, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { OfflineError } from '../../api/client';
import { generateExercises } from '../../api/exercises';
import { getModel } from '../../api/jobs';
import {
  formatScanStatus,
  getScan,
  getScanAnalysis,
  getScanImages,
  getScanModels,
  processScan,
  retryScanProcessing,
} from '../../api/scans';
import type {
  AnalysisResponse,
  GetScanDetailResponse,
  PatientAssetImage,
  PatientAssetModel,
  ScanSummary,
} from '../../api/types';
import { useConnectivity } from '../../connectivity/ConnectivityContext';
import { useRequiresOnline } from '../../hooks/useRequiresOnline';
import { findCachedScan, loadExercisePlan, saveExercisePlan } from '../../offline/localCache';
import { OFFLINE_ACTION_MESSAGE, OFFLINE_ASSET_UNAVAILABLE } from '../../offline/messages';
import { hedgedLikelihood } from '../../utils/copy';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { ExerciseList } from '../exercise/ExerciseList';
import { PageHeader } from '../layout/PageHeader';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Progress } from '../ui/progress';
import { analysisWasPossible, DeformityList } from '../analysis/DeformityList';
import { MeasurementConflictNotice, MuscleContribution } from '../analysis/MuscleContribution';

const PROCESSING_STATUSES = new Set([
  'PROCESSING',
  'ANALYZING',
  'GENERATING_MODEL',
  'UPLOADING',
]);

const ANALYSIS_READY_STATUSES = new Set(['GENERATING_MODEL', 'COMPLETED', 'FAILED']);

function buildOfflineDetail(scan: ScanSummary): GetScanDetailResponse {
  return {
    scan,
    job: null,
  };
}

export function ScanDetailScreen() {
  const { userId } = useAppAuth();
  const { dispatch, state } = useWorkflow();
  const { isOnline } = useConnectivity();
  const { offlineMessage } = useRequiresOnline();
  const scanId = state.scanId;
  const patientId = state.activePatient?.id ?? state.patientId;
  const [detail, setDetail] = useState<GetScanDetailResponse | null>(null);
  const [images, setImages] = useState<PatientAssetImage[]>([]);
  const [models, setModels] = useState<PatientAssetModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loadingExercises, setLoadingExercises] = useState(false);
  const [exercisesError, setExercisesError] = useState<string | null>(null);
  const riggedUrlRef = useRef<string | null>(null);

  const loadOfflineDetail = useCallback(() => {
    if (!userId || !patientId || !scanId) return false;
    const cachedScan = findCachedScan(userId, patientId, scanId);
    if (!cachedScan) return false;
    setDetail(buildOfflineDetail(cachedScan));
    setImages([]);
    setModels([]);
    return true;
  }, [patientId, scanId, userId]);

  const reload = useCallback(async () => {
    if (!scanId) return;
    const [scanRes, imagesRes, modelsRes] = await Promise.all([
      getScan(scanId),
      getScanImages(scanId),
      getScanModels(scanId),
    ]);
    setDetail(scanRes);
    setImages(imagesRes.images);
    setModels(modelsRes.models);
    if (scanRes.job?.id) {
      dispatch({ type: 'SET_JOB', jobId: scanRes.job.id });
    }
  }, [dispatch, scanId]);

  useEffect(() => {
    if (!scanId) {
      setLoading(false);
      setError('No scan selected.');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    if (!isOnline) {
      const loaded = loadOfflineDetail();
      if (!cancelled) {
        setError(loaded ? null : 'Scan unavailable offline.');
        setLoading(false);
      }
      return () => {
        cancelled = true;
      };
    }

    reload()
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        const loaded = loadOfflineDetail();
        if (!loaded) {
          setError(err instanceof OfflineError ? 'Scan unavailable offline.' : 'Could not load scan details.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOnline, loadOfflineDetail, reload, scanId]);

  useEffect(() => {
    if (!isOnline || !scanId || !detail?.job?.id || !ANALYSIS_READY_STATUSES.has(detail.scan.status)) {
      return;
    }

    let cancelled = false;
    void getScanAnalysis(scanId)
      .then((result) => {
        if (cancelled) return;
        setAnalysis(result);
        setAnalysisJobId(result.jobId);
        setExercises(loadExercisePlan(result.jobId) ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setAnalysis(null);
          setAnalysisJobId(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detail?.job?.id, detail?.scan.status, isOnline, scanId]);

  useEffect(() => {
    if (!isOnline || !scanId || !detail?.scan || !PROCESSING_STATUSES.has(detail.scan.status)) return;

    const timer = window.setInterval(() => {
      void reload().catch((err) => console.error(err));
    }, 3000);

    return () => window.clearInterval(timer);
  }, [detail?.scan, isOnline, reload, scanId]);

  const startProcessing = async () => {
    if (!scanId) return;
    if (!isOnline) {
      setError(OFFLINE_ACTION_MESSAGE);
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const result = await processScan(scanId);
      dispatch({ type: 'SET_JOB', jobId: result.jobId });
      dispatch({ type: 'SET_STAGE', stage: 'processing' });
    } catch (err) {
      console.error(err);
      setError('Could not start processing for this scan.');
    } finally {
      setActionLoading(false);
    }
  };

  const retryProcessing = async () => {
    if (!scanId) return;
    if (!isOnline) {
      setError(OFFLINE_ACTION_MESSAGE);
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const result = await retryScanProcessing(scanId);
      dispatch({ type: 'SET_JOB', jobId: result.jobId });
      dispatch({ type: 'SET_STAGE', stage: 'processing' });
    } catch (err) {
      console.error(err);
      setError('Retry could not be started.');
    } finally {
      setActionLoading(false);
    }
  };

  const openAnalysis = async () => {
    if (!scanId || !detail?.job?.id) return;
    if (!isOnline) {
      setError(OFFLINE_ACTION_MESSAGE);
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const [analysis, model] = await Promise.all([
        getScanAnalysis(scanId),
        getModel(detail.job.id),
      ]);
      dispatch({ type: 'SET_JOB', jobId: detail.job.id });
      dispatch({ type: 'SET_ANALYSIS', analysis });
      dispatch({ type: 'SET_RIGGED_URL', url: model.riggedGlbUrl });
      dispatch({ type: 'SET_STAGE', stage: 'results' });
    } catch (err) {
      console.error(err);
      setError('Analysis results are not available yet.');
    } finally {
      setActionLoading(false);
    }
  };

  const loadExercises = async () => {
    if (!analysisJobId) return;
    if (!isOnline) {
      setExercisesError(OFFLINE_ACTION_MESSAGE);
      return;
    }
    setLoadingExercises(true);
    setExercisesError(null);
    try {
      const model = await getModel(analysisJobId).catch(() => ({ glbUrl: null, riggedGlbUrl: null }));
      riggedUrlRef.current = model.riggedGlbUrl;
      const { exercises: loaded } = await generateExercises(analysisJobId);
      setExercises(loaded);
      saveExercisePlan(analysisJobId, loaded);
    } catch (err) {
      console.error(err);
      setExercisesError('Could not load exercises for this scan.');
    } finally {
      setLoadingExercises(false);
    }
  };

  const startExercise = (index: number) => {
    if (!analysis || !analysisJobId || exercises.length === 0 || !patientId) return;
    dispatch({ type: 'SET_JOB', jobId: analysisJobId });
    dispatch({ type: 'SET_ANALYSIS', analysis });
    dispatch({ type: 'SET_RIGGED_URL', url: riggedUrlRef.current });
    dispatch({ type: 'SET_EXERCISES', exercises });
    dispatch({ type: 'SET_EXERCISE_RETURN_STAGE', stage: 'scan_detail' });
    dispatch({ type: 'SET_EXERCISE_INDEX', index });
    dispatch({ type: 'SET_STAGE', stage: 'exercise_session' });
  };

  if (loading) {
    return (
      <div className="mx-auto flex max-w-5xl items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading scan…
      </div>
    );
  }

  if (error && !detail?.scan) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-8">
        <Alert variant="destructive">
          <AlertDescription>{error ?? 'Scan not available.'}</AlertDescription>
        </Alert>
        <Button type="button" variant="ghost" onClick={() => dispatch({ type: 'SET_STAGE', stage: 'patient_detail' })}>
          Back to patient
        </Button>
      </div>
    );
  }

  if (!detail?.scan) {
    return null;
  }

  const scan = detail.scan;
  const job = detail.job;
  const isProcessing = isOnline && PROCESSING_STATUSES.has(scan.status);
  const canProcess = isOnline && scan.status === 'UPLOADED';
  const canRetry = isOnline && scan.status === 'FAILED';
  const analysisPossible = analysis ? analysisWasPossible(analysis) : true;
  const canViewAnalysis = isOnline && Boolean(analysis) && analysisPossible && Boolean(job?.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <PageHeader
        title={`Scan ${scan.id.slice(0, 8)}`}
        description={new Date(scan.createdAt).toLocaleString()}
      >
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => dispatch({ type: 'SET_STAGE', stage: 'patient_detail' })}>
            Back
          </Button>
          {canProcess ? (
            <Button type="button" disabled={actionLoading} onClick={() => void startProcessing()}>
              Start processing
            </Button>
          ) : null}
          {canRetry ? (
            <Button type="button" disabled={actionLoading} onClick={() => void retryProcessing()}>
              Retry
            </Button>
          ) : null}
          {canViewAnalysis ? (
            <Button type="button" disabled={actionLoading} onClick={() => void openAnalysis()}>
              View analysis
            </Button>
          ) : null}
          {!isOnline ? (
            <Button type="button" disabled title={offlineMessage}>
              Offline
            </Button>
          ) : null}
        </div>
      </PageHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Badge variant={scan.status === 'FAILED' ? 'destructive' : 'secondary'}>
            {formatScanStatus(scan.status)}
          </Badge>
          {isProcessing ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Processing…</p>
              {job ? <Progress value={job.progress} className="h-2" /> : null}
              {job?.currentStep ? (
                <p className="text-xs text-muted-foreground">{job.currentStep}</p>
              ) : null}
            </div>
          ) : null}
          {scan.status === 'FAILED' && scan.error ? (
            <Alert variant="destructive">
              <AlertDescription>{scan.error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Images</CardTitle>
          <CardDescription>{images.length} captured image(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {!isOnline ? (
            <p className="text-sm text-muted-foreground">{OFFLINE_ASSET_UNAVAILABLE}</p>
          ) : images.length === 0 ? (
            <p className="text-sm text-muted-foreground">No images uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {images.slice(0, 12).map((image) => (
                <img
                  key={image.id}
                  src={image.url}
                  alt={image.originalName ?? 'Scan image'}
                  className="aspect-[3/4] w-full rounded-md border object-cover"
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3D Model</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!isOnline ? (
            <p className="text-sm text-muted-foreground">{OFFLINE_ASSET_UNAVAILABLE}</p>
          ) : models.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isProcessing ? 'Generating model…' : 'No 3D model available yet.'}
            </p>
          ) : (
            models.map((model) => (
              <div key={model.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
                <span>{model.fileName ?? `${model.format} model`}</span>
                <Button type="button" variant="outline" size="sm" asChild>
                  <a href={model.url} target="_blank" rel="noreferrer">
                    Open model
                  </a>
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analysis</CardTitle>
          <CardDescription>AI-assisted muscle mapping output (not a medical diagnosis).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isOnline ? (
            <p className="text-sm text-muted-foreground">{OFFLINE_ASSET_UNAVAILABLE}</p>
          ) : analysis ? (
            <>
              {analysisPossible ? null : (
                <p className="text-sm font-medium">This scan could not be analysed</p>
              )}
              <p className="text-sm">{analysis.summary}</p>
              {analysisPossible ? (
                <p className="text-sm text-muted-foreground">
                  {analysis.bodyRegion} · {analysis.observedDeformation}
                </p>
              ) : null}
              <MeasurementConflictNotice conflict={analysis.measurementConflict} />
              {analysisPossible && scan.status !== 'COMPLETED' ? (
                <p className="text-sm text-muted-foreground">
                  The 3D model is still being built. This analysis is ready to review.
                </p>
              ) : null}
              <DeformityList deformities={analysis.deformities} />
              <ul className="space-y-2">
                {analysis.muscles.map((muscle, index) => (
                  <li key={`${muscle.name}-${index}`} className="rounded-lg border px-3 py-2">
                    <p className="text-sm font-medium">{muscle.name}</p>
                    <p className="text-sm text-primary">{hedgedLikelihood(muscle.likelihood)}</p>
                    <MuscleContribution percent={muscle.contributionPercent} />
                    <p className="text-sm text-muted-foreground">{muscle.reason}</p>
                  </li>
                ))}
              </ul>
              {analysisPossible ? (
                <Button type="button" variant="outline" disabled={actionLoading} onClick={() => void openAnalysis()}>
                  Open full results
                </Button>
              ) : null}
            </>
          ) : isProcessing ? (
            <p className="text-sm text-muted-foreground">Analysis will appear when the scan has been read.</p>
          ) : scan.status === 'FAILED' ? (
            <p className="text-sm text-muted-foreground">Analysis unavailable because processing failed.</p>
          ) : (
            <p className="text-sm text-muted-foreground">Analysis not available yet.</p>
          )}
        </CardContent>
      </Card>

      {analysis && analysisPossible ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Dumbbell className="size-4" />
              Exercises
            </CardTitle>
            <CardDescription>Personalized exercises from this analysis.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {exercises.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Generate a personalized exercise plan from this analysis.
                </p>
                {exercisesError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{exercisesError}</AlertDescription>
                  </Alert>
                ) : null}
                <Button type="button" disabled={loadingExercises || !isOnline} onClick={() => void loadExercises()}>
                  {loadingExercises ? <Loader2 className="size-4 animate-spin" /> : <Dumbbell />}
                  {loadingExercises ? 'Generating exercises…' : 'Load exercises'}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {exercisesError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{exercisesError}</AlertDescription>
                  </Alert>
                ) : null}
                <ExerciseList
                  exercises={exercises}
                  onSelectExercise={startExercise}
                  showStartAll
                  onStartAll={() => startExercise(0)}
                />
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
