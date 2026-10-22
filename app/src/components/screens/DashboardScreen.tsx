import { useAppAuth } from '../../auth/AppAuthContext';
import { ArrowRight, Plus, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { getHealth } from '../../api/jobs';
import { getPatients } from '../../api/patients';
import type { HealthResponse, PatientSummary } from '../../api/types';
import { useConnectivity } from '../../connectivity/ConnectivityContext';
import { useRequiresOnline } from '../../hooks/useRequiresOnline';
import { loadPatientList, savePatientList } from '../../offline/localCache';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { PageHeader } from '../layout/PageHeader';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

export function DashboardScreen() {
  const { userId } = useAppAuth();
  const { dispatch } = useWorkflow();
  const { isOnline } = useConnectivity();
  const { offlineMessage } = useRequiresOnline();
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const loadPatients = useCallback(async () => {
    if (!userId) {
      setPatients([]);
      setLoadingPatients(false);
      return;
    }

    if (!isOnline) {
      const cached = loadPatientList(userId);
      setPatients(cached?.slice(0, 5) ?? []);
      setLoadingPatients(false);
      return;
    }

    try {
      const res = await getPatients();
      setPatients(res.patients.slice(0, 5));
      savePatientList(userId, res.patients);
    } catch (err) {
      console.error(err);
      const cached = loadPatientList(userId);
      setPatients(cached?.slice(0, 5) ?? []);
    } finally {
      setLoadingPatients(false);
    }
  }, [isOnline, userId]);

  useEffect(() => {
    let cancelled = false;

    if (!isOnline) {
      setBackendReachable(false);
      void loadPatients();
      return () => {
        cancelled = true;
      };
    }

    getHealth()
      .then((res) => {
        if (cancelled) return;
        setHealth(res);
        setBackendReachable(res.status === 'ok' && res.database === 'ok');
      })
      .catch(() => {
        if (!cancelled) setBackendReachable(false);
      });

    void loadPatients();

    return () => {
      cancelled = true;
    };
  }, [isOnline, loadPatients]);

  return (
    <div className="mx-auto max-w-5xl p-8">
      <PageHeader
        title="Dashboard"
        description="Overview of your hospital workspace and recent patients."
      />
      <p className="mb-4 text-sm text-muted-foreground">
        Backend reachable:{' '}
        {!isOnline
          ? 'NO (offline)'
          : backendReachable === null
            ? 'checking…'
            : backendReachable
              ? 'YES'
              : 'NO'}
      </p>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Active AI models</CardTitle>
            <CardDescription>
              Gemini models currently used for analysis and reference image generation.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Analysis
              </p>
              <Badge variant="secondary" className="font-mono text-xs">
                {!isOnline
                  ? 'Unavailable offline'
                  : health?.models.analysis ??
                    (backendReachable === false ? 'Unavailable' : 'Loading…')}
              </Badge>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Image generation
              </p>
              <Badge variant="secondary" className="font-mono text-xs">
                {!isOnline
                  ? 'Unavailable offline'
                  : health?.models.imageGeneration ??
                    (backendReachable === false ? 'Unavailable' : 'Loading…')}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Patient management</CardTitle>
            <CardDescription>
              Select or create a patient before starting a scan.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" onClick={() => dispatch({ type: 'SET_STAGE', stage: 'patients' })}>
              <Users />
              Open patients
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!isOnline}
              title={!isOnline ? offlineMessage : undefined}
              onClick={() => dispatch({ type: 'SET_STAGE', stage: 'add_patient' })}
            >
              <Plus />
              Add patient
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent patients</CardTitle>
            <CardDescription>
              Quick access to recently updated patient records.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingPatients ? (
              <p className="text-sm text-muted-foreground">Loading patients…</p>
            ) : null}
            {!loadingPatients && patients.length === 0 ? (
              <Alert>
                <AlertDescription>
                  No patients yet. Add a patient before starting a scan.
                </AlertDescription>
              </Alert>
            ) : null}
            <ul className="space-y-2">
              {patients.map((patient) => (
                <li key={patient.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg border bg-background/60 px-4 py-3 text-left transition-colors hover:bg-accent"
                    onClick={() => {
                      dispatch({ type: 'SET_ACTIVE_PATIENT', patient });
                      dispatch({ type: 'SET_STAGE', stage: 'patient_detail' });
                    }}
                  >
                    <span className="font-medium">{patient.fullName}</span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
