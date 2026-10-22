import type { Hospital } from '@prisma/client';
import { prisma } from './prisma';

export interface EnsureHospitalDefaults {
  defaultName: string;
  defaultEmail: string | null;
}

export async function findHospitalForUser(userId: string): Promise<Hospital | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hospital: true },
  });
  return user?.hospital ?? null;
}

/**
 * Idempotent: returns the user's hospital, creating one if missing.
 * Safe under concurrent requests for the same user.
 */
export async function ensureHospitalForUser(
  userId: string,
  defaults: EnsureHospitalDefaults,
): Promise<Hospital> {
  const existing = await findHospitalForUser(userId);
  if (existing) {
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;

    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { hospital: true },
    });

    if (!user) {
      throw new Error(`User ${userId} was not found.`);
    }

    if (user.hospital) {
      return user.hospital;
    }

    const hospital = await tx.hospital.create({
      data: {
        name: defaults.defaultName,
        email: defaults.defaultEmail,
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: { hospitalId: hospital.id },
    });

    return hospital;
  });
}

export function serializeHospital(hospital: Hospital) {
  return {
    id: hospital.id,
    name: hospital.name,
    email: hospital.email,
    phone: hospital.phone,
    address: hospital.address,
    createdAt: hospital.createdAt.toISOString(),
    updatedAt: hospital.updatedAt.toISOString(),
  };
}
