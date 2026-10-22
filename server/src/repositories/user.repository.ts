import type { User } from '@prisma/client';
import { prisma } from './prisma';

export async function upsertUser(id: string, email: string | null): Promise<User> {
  return prisma.user.upsert({
    where: { id },
    create: { id, email },
    update: email === null ? {} : { email },
  });
}
