import { useAppAuth } from '../../auth/AppAuthContext';

import { Loader2, Plus, Search } from 'lucide-react';

import { useCallback, useEffect, useState } from 'react';

import { OfflineError } from '../../api/client';

import {

  formatGender,

  getPatients,

  patientAgeLabel,

  patientDisplayName,

} from '../../api/patients';

import type { PatientSummary } from '../../api/types';

import { useConnectivity } from '../../connectivity/ConnectivityContext';

import { useRequiresOnline } from '../../hooks/useRequiresOnline';

import {

  filterPatientSummaries,

  loadPatientList,

  savePatientList,

} from '../../offline/localCache';

import { OFFLINE_PATIENTS_UNAVAILABLE } from '../../offline/messages';

import { useWorkflow } from '../../workflow/WorkflowContext';

import { PageHeader } from '../layout/PageHeader';

import { Alert, AlertDescription } from '../ui/alert';

import { Badge } from '../ui/badge';

import { Button } from '../ui/button';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

import { Input } from '../ui/input';



export function PatientsScreen() {

  const { userId } = useAppAuth();

  const { dispatch } = useWorkflow();

  const { isOnline } = useConnectivity();

  const { offlineMessage } = useRequiresOnline();

  const [patients, setPatients] = useState<PatientSummary[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');

  const [query, setQuery] = useState('');



  useEffect(() => {

    const timer = window.setTimeout(() => setQuery(search.trim()), 250);

    return () => window.clearTimeout(timer);

  }, [search]);



  const loadPatients = useCallback(async () => {

    if (!userId) {

      setPatients([]);

      setLoading(false);

      return;

    }



    setLoading(true);

    setError(null);



    if (!isOnline) {

      const cached = loadPatientList(userId);

      if (cached) {

        setPatients(filterPatientSummaries(cached, query));

      } else {

        setPatients([]);

        setError(OFFLINE_PATIENTS_UNAVAILABLE);

      }

      setLoading(false);

      return;

    }



    try {

      const res = await getPatients(query || undefined);

      setPatients(res.patients);

      savePatientList(userId, res.patients);

    } catch (err) {

      console.error(err);

      const cached = loadPatientList(userId);

      if (cached) {

        setPatients(filterPatientSummaries(cached, query));

      } else if (err instanceof OfflineError) {

        setError(OFFLINE_PATIENTS_UNAVAILABLE);

      } else {

        setError('Could not load patients.');

      }

    } finally {

      setLoading(false);

    }

  }, [isOnline, query, userId]);



  useEffect(() => {

    void loadPatients();

  }, [loadPatients]);



  return (

    <div className="mx-auto max-w-5xl p-8">

      <PageHeader

        title="Patients"

        description="Manage patients linked to your hospital."

      >

        <Button

          type="button"

          disabled={!isOnline}

          title={!isOnline ? offlineMessage : undefined}

          onClick={() => dispatch({ type: 'SET_STAGE', stage: 'add_patient' })}

        >

          <Plus />

          Add patient

        </Button>

      </PageHeader>



      <Card className="mb-6">

        <CardContent className="pt-6">

          <div className="relative">

            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />

            <Input

              value={search}

              onChange={(e) => setSearch(e.target.value)}

              placeholder="Search by name, phone, or patient ID"

              className="pl-9"

            />

          </div>

        </CardContent>

      </Card>



      <Card>

        <CardHeader>

          <CardTitle>Patient list</CardTitle>

          <CardDescription>

            Select a patient to open their workspace.

          </CardDescription>

        </CardHeader>

        <CardContent className="space-y-3">

          {loading ? (

            <p className="flex items-center gap-2 text-sm text-muted-foreground">

              <Loader2 className="size-4 animate-spin" />

              Loading patients…

            </p>

          ) : null}

          {error ? (

            <Alert variant="destructive">

              <AlertDescription>{error}</AlertDescription>

            </Alert>

          ) : null}

          {!loading && patients.length === 0 ? (

            <p className="text-sm text-muted-foreground">No patients found.</p>

          ) : null}

          <ul className="space-y-2">

            {patients.map((patient) => (

              <li key={patient.id}>

                <button

                  type="button"

                  className="flex w-full flex-col gap-3 rounded-lg border bg-background/60 px-4 py-3 text-left transition-colors hover:bg-accent sm:flex-row sm:items-center sm:justify-between"

                  onClick={() => {

                    dispatch({ type: 'SET_ACTIVE_PATIENT', patient });

                    dispatch({ type: 'SET_STAGE', stage: 'patient_detail' });

                  }}

                >

                  <div>

                    <p className="font-medium">{patientDisplayName(patient)}</p>

                    <p className="mt-1 font-mono text-xs text-muted-foreground">{patient.id}</p>

                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">

                    <Badge variant="secondary">Age {patientAgeLabel(patient.dateOfBirth)}</Badge>

                    <Badge variant="outline">{formatGender(patient.gender)}</Badge>

                    <span>Updated {new Date(patient.updatedAt).toLocaleDateString()}</span>

                  </div>

                </button>

              </li>

            ))}

          </ul>

        </CardContent>

      </Card>

    </div>

  );

}

