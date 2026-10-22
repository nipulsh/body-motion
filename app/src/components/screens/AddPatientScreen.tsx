import { useAppAuth } from '../../auth/AppAuthContext';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { createPatient } from '../../api/patients';
import type { CreatePatientInput, PatientSummary } from '../../api/types';
import { useRequiresOnline } from '../../hooks/useRequiresOnline';
import { loadPatientList, savePatientList } from '../../offline/localCache';
import { OFFLINE_ACTION_MESSAGE } from '../../offline/messages';

import { useWorkflow } from '../../workflow/WorkflowContext';

import { PageHeader } from '../layout/PageHeader';

import { Alert, AlertDescription } from '../ui/alert';

import { Button } from '../ui/button';

import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

import { Input } from '../ui/input';

import { Label } from '../ui/label';

import {

  Select,

  SelectContent,

  SelectItem,

  SelectTrigger,

  SelectValue,

} from '../ui/select';

import { cn } from '@/lib/utils';



const textareaClassName = cn(

  'min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',

  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',

);



const emptyForm: CreatePatientInput = {

  firstName: '',

  lastName: '',

  dateOfBirth: '',

  gender: null,

  phone: '',

  email: '',

  deformities: '',

  chronicConditions: '',

  notes: '',

};



export function AddPatientScreen() {

  const { userId } = useAppAuth();

  const { dispatch } = useWorkflow();

  const { isOnline, offlineMessage } = useRequiresOnline();

  const [form, setForm] = useState<CreatePatientInput>(emptyForm);

  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState<string | null>(null);



  const updateField = <K extends keyof CreatePatientInput>(key: K, value: CreatePatientInput[K]) => {

    setForm((current) => ({ ...current, [key]: value }));

  };



  const submit = async () => {

    if (!isOnline) {

      setError(OFFLINE_ACTION_MESSAGE);

      return;

    }



    if (!form.firstName.trim() || !form.lastName.trim()) {

      setError('First name and last name are required.');

      return;

    }



    setSubmitting(true);

    setError(null);

    try {

      const response = await createPatient({

        firstName: form.firstName.trim(),

        lastName: form.lastName.trim(),

        dateOfBirth: form.dateOfBirth || null,

        gender: form.gender ?? null,

        phone: form.phone?.trim() || undefined,

        email: form.email?.trim() || null,

        deformities: form.deformities?.trim() || undefined,

        chronicConditions: form.chronicConditions?.trim() || undefined,

        notes: form.notes?.trim() || undefined,

      });

      dispatch({ type: 'SET_ACTIVE_PATIENT', patient: response.patient });

      if (userId) {
        const cached = loadPatientList(userId) ?? [];
        const nextPatient: PatientSummary = {
          id: response.patient.id,
          firstName: response.patient.firstName,
          lastName: response.patient.lastName,
          fullName: response.patient.fullName,
          dateOfBirth: response.patient.dateOfBirth,
          gender: response.patient.gender,
          phone: response.patient.phone,
          email: response.patient.email,
          createdAt: response.patient.createdAt,
          updatedAt: response.patient.updatedAt,
        };
        savePatientList(userId, [nextPatient, ...cached.filter((p) => p.id !== nextPatient.id)]);
      }

      dispatch({ type: 'SET_STAGE', stage: 'patient_detail' });

    } catch (err) {

      console.error(err);

      setError('Could not create patient. Check the form and try again.');

    } finally {

      setSubmitting(false);

    }

  };



  return (

    <div className="mx-auto max-w-3xl p-8">

      <PageHeader

        title="Add patient"

        description="Create a new patient record for your hospital."

      />



      {!isOnline ? (

        <Alert variant="destructive" className="mb-4">

          <AlertDescription>{offlineMessage}</AlertDescription>

        </Alert>

      ) : null}



      <Card>

        <CardHeader>

          <CardTitle className="text-base">Basic information</CardTitle>

        </CardHeader>

        <CardContent className="space-y-4">

          <div className="grid gap-4 sm:grid-cols-2">

            <div className="space-y-2">

              <Label htmlFor="firstName">First name</Label>

              <Input

                id="firstName"

                value={form.firstName}

                disabled={!isOnline}

                onChange={(e) => updateField('firstName', e.target.value)}

              />

            </div>

            <div className="space-y-2">

              <Label htmlFor="lastName">Last name</Label>

              <Input

                id="lastName"

                value={form.lastName}

                disabled={!isOnline}

                onChange={(e) => updateField('lastName', e.target.value)}

              />

            </div>

            <div className="space-y-2">

              <Label htmlFor="dateOfBirth">Date of birth</Label>

              <Input

                id="dateOfBirth"

                type="date"

                disabled={!isOnline}

                value={form.dateOfBirth ?? ''}

                onChange={(e) => updateField('dateOfBirth', e.target.value)}

              />

            </div>

            <div className="space-y-2">

              <Label>Gender</Label>

              <Select

                value={form.gender ?? 'unknown'}

                disabled={!isOnline}

                onValueChange={(value) =>

                  updateField('gender', value as CreatePatientInput['gender'])

                }

              >

                <SelectTrigger>

                  <SelectValue placeholder="Select gender" />

                </SelectTrigger>

                <SelectContent>

                  <SelectItem value="male">Male</SelectItem>

                  <SelectItem value="female">Female</SelectItem>

                  <SelectItem value="other">Other</SelectItem>

                  <SelectItem value="unknown">Unknown</SelectItem>

                </SelectContent>

              </Select>

            </div>

            <div className="space-y-2">

              <Label htmlFor="phone">Phone</Label>

              <Input

                id="phone"

                disabled={!isOnline}

                value={form.phone ?? ''}

                onChange={(e) => updateField('phone', e.target.value)}

              />

            </div>

            <div className="space-y-2">

              <Label htmlFor="email">Email</Label>

              <Input

                id="email"

                type="email"

                disabled={!isOnline}

                value={form.email ?? ''}

                onChange={(e) => updateField('email', e.target.value)}

              />

            </div>

          </div>



          <div className="space-y-2">

            <Label htmlFor="deformities">Deformities</Label>

            <textarea

              id="deformities"

              className={textareaClassName}

              disabled={!isOnline}

              value={form.deformities ?? ''}

              onChange={(e) => updateField('deformities', e.target.value)}

            />

          </div>

          <div className="space-y-2">

            <Label htmlFor="chronicConditions">Chronic conditions</Label>

            <textarea

              id="chronicConditions"

              className={textareaClassName}

              disabled={!isOnline}

              value={form.chronicConditions ?? ''}

              onChange={(e) => updateField('chronicConditions', e.target.value)}

            />

          </div>

          <div className="space-y-2">

            <Label htmlFor="notes">Notes</Label>

            <textarea

              id="notes"

              className={textareaClassName}

              disabled={!isOnline}

              value={form.notes ?? ''}

              onChange={(e) => updateField('notes', e.target.value)}

            />

          </div>



          {error ? (

            <Alert variant="destructive">

              <AlertDescription>{error}</AlertDescription>

            </Alert>

          ) : null}



          <div className="flex flex-col gap-2 sm:flex-row">

            <Button

              type="button"

              disabled={submitting || !isOnline}

              title={!isOnline ? offlineMessage : undefined}

              onClick={() => void submit()}

            >

              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}

              Save patient

            </Button>

            <Button

              type="button"

              variant="ghost"

              disabled={submitting}

              onClick={() => dispatch({ type: 'SET_STAGE', stage: 'patients' })}

            >

              Cancel

            </Button>

          </div>

        </CardContent>

      </Card>

    </div>

  );

}

