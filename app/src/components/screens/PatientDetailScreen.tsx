import { useAppAuth } from '../../auth/AppAuthContext';
import type { Exercise } from '@vision';
import { Camera, Dumbbell, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OfflineError } from '../../api/client';
import { generateExercises } from '../../api/exercises';
import { getAnalysis, getModel } from '../../api/jobs';
import {
  formatGender,
  getPatient,
  patientAgeLabel,
  patientDisplayName,
} from '../../api/patients';
import {
  createScan,
  formatScanStatus,
  getPatientImages,
  getPatientModels,
  getPatientScans,
} from '../../api/scans';
import type {
  AnalysisResponse,
  JobSummary,
  PatientAssetImage,
  PatientAssetModel,
  PatientDetail,
  ScanSummary,
} from '../../api/types';
import { ExerciseList } from '../exercise/ExerciseList';
import { useConnectivity } from '../../connectivity/ConnectivityContext';
import { useRequiresOnline } from '../../hooks/useRequiresOnline';
import { loadExercisePlan, loadPatientBundle, saveExercisePlan, savePatientBundle } from '../../offline/localCache';
import { OFFLINE_ACTION_MESSAGE, OFFLINE_ASSET_UNAVAILABLE, OFFLINE_PATIENT_UNAVAILABLE } from '../../offline/messages';
import { hedgedLikelihood } from '../../utils/copy';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { PageHeader } from '../layout/PageHeader';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { analysisWasPossible, DeformityList } from '../analysis/DeformityList';
import { MuscleContribution } from '../analysis/MuscleContribution';

export function PatientDetailScreen() {
  const { userId } = useAppAuth();
  const { dispatch, state } = useWorkflow();
  const { isOnline } = useConnectivity();
  const { offlineMessage } = useRequiresOnline();
  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [images, setImages] = useState<PatientAssetImage[]>([]);
  const [models, setModels] = useState<PatientAssetModel[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingScan, setStartingScan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAnalysis, setSavedAnalysis] = useState<AnalysisResponse | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loadingExercises, setLoadingExercises] = useState(false);
  const [exercisesError, setExercisesError] = useState<string | null>(null);
  const exerciseContextRef = useRef<{
    jobId: string;
    analysis: AnalysisResponse;
    riggedGlbUrl: string | null;
  } | null>(null);

  const patientId = state.activePatient?.id ?? state.patientId;

  const analysisJobs = useMemo(() => jobs.filter((job) => job.analysis), [jobs]);
  const latestAnalysisJob = analysisJobs[0] ?? null;
  const previousAnalyses = analysisJobs.slice(1);

  const applyCachedBundle = useCallback(() => {
    if (!userId || !patientId) return false;
    const cached = loadPatientBundle(userId, patientId);
    if (!cached) return false;
    setPatient(cached.patient);
    setScans(cached.scans);
    setImages([]);
    setModels([]);
    dispatch({ type: 'SET_ACTIVE_PATIENT', patient: cached.patient });
    return true;
  }, [dispatch, patientId, userId]);

  useEffect(() => {
    if (!patientId) {
      setLoading(false);
      setError('No patient selected.');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    if (!isOnline) {
      const loaded = applyCachedBundle();
      if (!cancelled) {
        setError(loaded ? null : OFFLINE_PATIENT_UNAVAILABLE);
        setLoading(false);
      }
      return () => {
        cancelled = true;
      };
    }

    Promise.all([
      getPatient(patientId),
      getPatientScans(patientId),
      getPatientImages(patientId),
      getPatientModels(patientId),
    ])
      .then(([patientRes, scansRes, imagesRes, modelsRes]) => {
        if (cancelled) return;
        setPatient(patientRes.patient);
        setJobs(patientRes.jobs);
        setScans(scansRes.scans);
        setImages(imagesRes.images);
        setModels(modelsRes.models);
        dispatch({ type: 'SET_ACTIVE_PATIENT', patient: patientRes.patient });
        if (userId) {
          savePatientBundle(userId, patientId, {
            patient: patientRes.patient,
            scans: scansRes.scans,
          });
        }
      })
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        const loaded = applyCachedBundle();
        if (!loaded) {
          setError(err instanceof OfflineError ? OFFLINE_PATIENT_UNAVAILABLE : 'Could not load patient details.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyCachedBundle, dispatch, isOnline, patientId, userId]);

  useEffect(() => {
    if (!latestAnalysisJob || !isOnline) {
      setSavedAnalysis(null);
      setExercises([]);
      exerciseContextRef.current = null;
      return;
    }

    const jobId = latestAnalysisJob.id;
    const cached = loadExercisePlan(jobId);
    setExercises(cached ?? []);
    setExercisesError(null);
    if (!cached || cached.length === 0) {
      setLoadingExercises(true);
    }

    let cancelled = false;
    void (async () => {
      let analysis: AnalysisResponse | null = null;
      let riggedGlbUrl: string | null = null;
      try {
        const [loadedAnalysis, model] = await Promise.all([
          getAnalysis(jobId),
          getModel(jobId).catch(() => ({ glbUrl: null, riggedGlbUrl: null })),
        ]);
        analysis = loadedAnalysis;
        riggedGlbUrl = model.riggedGlbUrl;
        if (cancelled) return;
        setSavedAnalysis(analysis);
        exerciseContextRef.current = { jobId, analysis, riggedGlbUrl };
      } catch (err) {
        console.error(err);
        if (!cancelled) setSavedAnalysis(null);
      }

      if (cancelled) return;
      // A scan that could not be analysed has nothing to plan exercises from.
      if (analysis && !analysisWasPossible(analysis)) {
        setExercises([]);
        setLoadingExercises(false);
        return;
      }
      if (cached && cached.length > 0) return;

      setLoadingExercises(true);
      try {
        const { exercises: loaded } = await generateExercises(jobId);
        if (cancelled) return;
        if (analysis) {
          exerciseContextRef.current = { jobId, analysis, riggedGlbUrl };
        }
        setExercises(loaded);
        saveExercisePlan(jobId, loaded);
      } catch (err) {
        console.error(err);
        if (!cancelled) setExercisesError('Could not load exercises for this patient.');
      } finally {
        if (!cancelled) setLoadingExercises(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOnline, latestAnalysisJob]);

  const openAnalysisJob = async (jobId: string) => {
    if (!patient) return;
    if (!isOnline) {
      setActionError(OFFLINE_ACTION_MESSAGE);
      return;
    }
    try {
      dispatch({
        type: 'SET_PATIENT',
        patientId: patient.id,
        name: patientDisplayName(patient),
        patient,
      });
      dispatch({ type: 'SET_JOB', jobId });
      const [analysis, model] = await Promise.all([
        getAnalysis(jobId),
        getModel(jobId).catch(() => ({ glbUrl: null, riggedGlbUrl: null })),
      ]);
      dispatch({ type: 'SET_ANALYSIS', analysis });
      dispatch({ type: 'SET_RIGGED_URL', url: model.riggedGlbUrl });
      dispatch({ type: 'SET_STAGE', stage: 'results' });
    } catch (err) {
      console.error(err);
      setActionError('Could not open analysis results.');
    }
  };

  const loadExercises = async () => {
    if (!patient || !latestAnalysisJob) return;
    if (!isOnline) {
      setExercisesError(OFFLINE_ACTION_MESSAGE);
      return;
    }

    setLoadingExercises(true);
    setExercisesError(null);

    try {
      const [analysis, model] = await Promise.all([
        getAnalysis(latestAnalysisJob.id),
        getModel(latestAnalysisJob.id).catch(() => ({ glbUrl: null, riggedGlbUrl: null })),
      ]);
      const { exercises: loaded } = await generateExercises(latestAnalysisJob.id);
      exerciseContextRef.current = {
        jobId: latestAnalysisJob.id,
        analysis,
        riggedGlbUrl: model.riggedGlbUrl,
      };
      setSavedAnalysis(analysis);
      setExercises(loaded);
      saveExercisePlan(latestAnalysisJob.id, loaded);
    } catch (err) {
      console.error(err);
      setExercisesError('Could not load exercises for this patient.');
    } finally {
      setLoadingExercises(false);
    }
  };

  const startExercise = (index: number) => {
    if (!patient || !exerciseContextRef.current || exercises.length === 0) return;

    const { jobId, analysis, riggedGlbUrl } = exerciseContextRef.current;

    dispatch({
      type: 'SET_PATIENT',
      patientId: patient.id,
      name: patientDisplayName(patient),
      patient,
    });
    dispatch({ type: 'SET_JOB', jobId });
    dispatch({ type: 'SET_ANALYSIS', analysis });
    dispatch({ type: 'SET_RIGGED_URL', url: riggedGlbUrl });
    dispatch({ type: 'SET_EXERCISES', exercises });
    dispatch({ type: 'SET_EXERCISE_RETURN_STAGE', stage: 'patient_detail' });
    dispatch({ type: 'SET_EXERCISE_INDEX', index });
    dispatch({ type: 'SET_STAGE', stage: 'exercise_session' });
  };

  const startScan = async () => {
    if (!patient) return;
    if (!isOnline) {
      setActionError(OFFLINE_ACTION_MESSAGE);
      return;
    }
    setStartingScan(true);
    setActionError(null);
    try {
      const createdScan = await createScan(patient.id);
      dispatch({
        type: 'SET_PATIENT',
        patientId: patient.id,
        name: patientDisplayName(patient),
        patient,
      });
      dispatch({ type: 'SET_SCAN', scanId: createdScan.scanId });
      dispatch({ type: 'SET_SCAN_CAPTURE_MODE', mode: 'BODY_360' });
      dispatch({ type: 'RESET_CAPTURES' });
      dispatch({ type: 'SET_STAGE', stage: 'camera_setup' });
    } catch (err) {
      console.error(err);
      setActionError('Could not start a new scan.');
    } finally {
      setStartingScan(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex max-w-5xl items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading patient…
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-8">
        <Alert variant="destructive">
          <AlertDescription>{error ?? 'Patient not available.'}</AlertDescription>
        </Alert>
        <Button type="button" variant="ghost" onClick={() => dispatch({ type: 'SET_STAGE', stage: 'patients' })}>
          Back to patients
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <PageHeader title={patientDisplayName(patient)} description="Patient workspace">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => dispatch({ type: 'SET_STAGE', stage: 'patients' })}>
            Back
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!isOnline || !latestAnalysisJob}
            title={!isOnline ? offlineMessage : undefined}
            onClick={() => {
              if (latestAnalysisJob) void openAnalysisJob(latestAnalysisJob.id);
            }}
          >
            View latest results
          </Button>
          <Button
            type="button"
            disabled={startingScan || !isOnline}
            title={!isOnline ? offlineMessage : undefined}
            onClick={() => void startScan()}
          >
            {startingScan ? <Loader2 className="size-4 animate-spin" /> : <Camera />}
            Start scan
          </Button>
        </div>
      </PageHeader>

      {actionError ? (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Patient information</CardTitle>
          <CardDescription>Core profile details for this patient.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <InfoField label="Patient ID" value={patient.id} mono />
          <InfoField label="Age" value={patientAgeLabel(patient.dateOfBirth)} />
          <InfoField label="Date of birth" value={patient.dateOfBirth ?? '—'} />
          <InfoField label="Gender" value={formatGender(patient.gender)} />
          <InfoField label="Phone" value={patient.phone ?? '—'} />
          <InfoField label="Email" value={patient.email ?? '—'} />
          <InfoField label="Deformities" value={patient.deformities ?? '—'} className="sm:col-span-2" />
          <InfoField
            label="Chronic conditions"
            value={patient.chronicConditions ?? '—'}
            className="sm:col-span-2"
          />
          <InfoField label="Notes" value={patient.notes ?? '—'} className="sm:col-span-2" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scans</CardTitle>
          <CardDescription>360° capture sessions linked to this patient.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {scans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scans yet.</p>
          ) : (
            scans.map((scan) => (
              <button
                key={scan.id}
                type="button"
                className="flex w-full flex-col gap-2 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-accent sm:flex-row sm:items-center sm:justify-between"
                onClick={() => {
                  dispatch({ type: 'SET_SCAN', scanId: scan.id });
                  dispatch({ type: 'SET_STAGE', stage: 'scan_detail' });
                }}
              >
                <div>
                  <p className="font-mono text-sm">{scan.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(scan.createdAt).toLocaleString()}
                  </p>
                </div>
                <Badge variant={scan.status === 'FAILED' ? 'destructive' : 'secondary'}>
                  {formatScanStatus(scan.status)}
                </Badge>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Images</CardTitle>
          <CardDescription>Captured scan images stored for this patient.</CardDescription>
        </CardHeader>
        <CardContent>
          {!isOnline ? (
            <p className="text-sm text-muted-foreground">{OFFLINE_ASSET_UNAVAILABLE}</p>
          ) : images.length === 0 ? (
            <p className="text-sm text-muted-foreground">No images uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {images.slice(0, 12).map((image) => (
                <figure key={image.id} className="space-y-1">
                  <img
                    src={image.url}
                    alt={image.originalName ?? 'Patient scan image'}
                    className="aspect-[3/4] w-full rounded-md border object-cover"
                  />
                  <figcaption className="text-xs text-muted-foreground">
                    {image.angle ? `${image.angle}°` : 'Capture'}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3D Models</CardTitle>
          <CardDescription>GLB models associated with this patient.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!isOnline ? (
            <p className="text-sm text-muted-foreground">{OFFLINE_ASSET_UNAVAILABLE}</p>
          ) : models.length === 0 ? (
            <p className="text-sm text-muted-foreground">No 3D models uploaded yet.</p>
          ) : (
            models.map((model) => (
              <div
                key={model.id}
                className="flex flex-col gap-2 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{model.fileName ?? `${model.format} model`}</p>
                  <p className="font-mono text-xs text-muted-foreground">{model.id}</p>
                </div>
                <Button type="button" variant="outline" size="sm" asChild>
                  <a href={model.url} target="_blank" rel="noreferrer">
                    Download
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
          <CardDescription>AI-assisted muscle mapping summaries per completed scan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isOnline ? (
            <p className="text-sm text-muted-foreground">{OFFLINE_ASSET_UNAVAILABLE}</p>
          ) : !latestAnalysisJob?.analysis ? (
            <p className="text-sm text-muted-foreground">
              No analysis yet. Complete a scan to generate one. Results are analysis summaries, not medical
              diagnoses.
            </p>
          ) : (
            <>
              <AnalysisBlock
                summary={savedAnalysis?.summary ?? latestAnalysisJob.analysis.summary}
                bodyRegion={savedAnalysis?.bodyRegion ?? latestAnalysisJob.analysis.bodyRegion}
                observedDeformation={
                  savedAnalysis?.observedDeformation ?? latestAnalysisJob.analysis.observedDeformation
                }
                muscles={savedAnalysis?.muscles}
                deformities={savedAnalysis?.deformities}
                analysisPossible={savedAnalysis ? analysisWasPossible(savedAnalysis) : true}
                inProgress={latestAnalysisJob.status !== 'COMPLETED'}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!isOnline}
                onClick={() => void openAnalysisJob(latestAnalysisJob.id)}
              >
                Open full results
              </Button>
              {previousAnalyses.length > 0 ? (
                <div className="space-y-2 border-t pt-4">
                  <p className="text-sm font-medium">Previous analyses</p>
                  {previousAnalyses.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      className="flex w-full flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-accent"
                      onClick={() => void openAnalysisJob(job.id)}
                    >
                      <span className="text-sm font-medium">{job.analysis?.bodyRegion}</span>
                      <span className="text-sm text-muted-foreground">{job.analysis?.summary}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(job.createdAt).toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Dumbbell className="size-4" />
            Exercises
          </CardTitle>
          <CardDescription>
            Personalized exercises from the latest completed analysis. Click an exercise to play with live pose
            tracking and your 3D model.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isOnline ? (
            <p className="text-sm text-muted-foreground">{OFFLINE_ASSET_UNAVAILABLE}</p>
          ) : !latestAnalysisJob ? (
            <p className="text-sm text-muted-foreground">
              Complete a scan and analysis first to generate exercises.
            </p>
          ) : savedAnalysis && !analysisWasPossible(savedAnalysis) ? (
            <p className="text-sm text-muted-foreground">
              The latest scan could not be analysed. Scan again to generate exercises.
            </p>
          ) : exercises.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Generate a personalized exercise plan based on the latest analysis.
              </p>
              {exercisesError ? (
                <Alert variant="destructive">
                  <AlertDescription>{exercisesError}</AlertDescription>
                </Alert>
              ) : null}
              <Button
                type="button"
                disabled={loadingExercises}
                onClick={() => void loadExercises()}
              >
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingExercises}
                onClick={() => void loadExercises()}
              >
                {loadingExercises ? <Loader2 className="size-4 animate-spin" /> : null}
                Regenerate plan
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AnalysisBlock({
  summary,
  bodyRegion,
  observedDeformation,
  muscles,
  deformities,
  analysisPossible,
  inProgress,
}: {
  summary: string;
  bodyRegion: string;
  observedDeformation: string;
  muscles?: AnalysisResponse['muscles'];
  deformities?: AnalysisResponse['deformities'];
  analysisPossible: boolean;
  inProgress: boolean;
}) {
  if (!analysisPossible) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">This scan could not be analysed</p>
        <p className="text-sm">{summary}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm">{summary}</p>
      <p className="text-sm text-muted-foreground">
        {bodyRegion} · {observedDeformation}
      </p>
      {inProgress ? (
        <p className="text-sm text-muted-foreground">
          The 3D model is still being built. This analysis is ready to review.
        </p>
      ) : null}
      <DeformityList deformities={deformities} />
      {muscles && muscles.length > 0 ? (
        <ul className="space-y-2">
          {muscles.map((muscle, index) => (
            <li key={`${muscle.name}-${index}`} className="rounded-lg border px-3 py-2">
              <p className="text-sm font-medium">{muscle.name}</p>
              <p className="text-sm text-primary">{hedgedLikelihood(muscle.likelihood)}</p>
              <MuscleContribution percent={muscle.contributionPercent} />
              <p className="text-sm text-muted-foreground">{muscle.reason}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function InfoField({
  label,
  value,
  mono = false,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-1 text-sm ${mono ? 'font-mono break-all' : ''}`}>{value}</p>
    </div>
  );
}
