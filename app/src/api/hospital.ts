import { apiFetch } from './client';
import type { GetMyHospitalResponse } from './types';

export async function getMyHospital(): Promise<GetMyHospitalResponse> {
  return apiFetch<GetMyHospitalResponse>('/api/hospital/me');
}
