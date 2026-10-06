'use server'

import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { safeUserSelect } from '@/lib/prisma-selects';
import { queryParticipationDetails, type ParticipationDetails } from './participation-sql';

export async function getParticipation(participationId: number) {
  await ensurePermission('participation:read');
  return prisma.participations.findUnique({
    where: { id: participationId },
    include: {
      users: { select: safeUserSelect },
      contests: true,
      submissions: { orderBy: { timestamp: 'desc' }, take: 10 },
      messages: { orderBy: { timestamp: 'desc' } },
      questions: { orderBy: { question_timestamp: 'desc' } },
    }
  });
}

export async function getParticipationDetails(id: number): Promise<ParticipationDetails | null> {
  await ensurePermission('participation:read');
  const p = await queryParticipationDetails(id);
  if (!p) return null;

  return {
    id: p.id,
    contest_id: p.contest_id,
    user_id: p.user_id,
    team_id: p.team_id,
    hidden: p.hidden,
    unrestricted: p.unrestricted,
    delay_time_seconds: p.delay_time_seconds || 0,
    extra_time_seconds: p.extra_time_seconds || 0,
    starting_time: p.starting_time ? new Date(p.starting_time).toISOString().slice(0, 16) : '',
    ip_string: p.ip_string || '',
  };
}
