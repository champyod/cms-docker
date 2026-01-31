'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

// Get participation details
export async function getParticipation(participationId: number) {
  return prisma.participations.findUnique({
    where: { id: participationId },
    include: {
      users: true,
      contests: true,
      submissions: { orderBy: { timestamp: 'desc' }, take: 10 },
      messages: { orderBy: { timestamp: 'desc' } },
      questions: { orderBy: { question_timestamp: 'desc' } },
    }
  });
}

// Update participation settings (uses raw SQL for interval and IP fields)
export async function updateParticipation(participationId: number, data: {
  team_id?: number | null;
  hidden?: boolean;
  unrestricted?: boolean;
  password?: string | null;
  extra_time_seconds?: number;
  delay_time_seconds?: number;
  ip?: string;
  starting_time?: string | null;
}) {
  try {
    const extraTime = data.extra_time_seconds ?? 0;
    const delayTime = data.delay_time_seconds ?? 0;
    const hidden = data.hidden ?? false;
    const unrestricted = data.unrestricted ?? false;
    const teamId = data.team_id ?? null;
    const password = data.password ?? null;
    const startingTime = data.starting_time ? new Date(data.starting_time) : null;

    // Parse IP addresses - handle comma-separated list
    const ipArray = data.ip
      ? data.ip.split(',').map(ip => ip.trim()).filter(ip => ip.length > 0)
      : [];

    // Build the IP array literal safely
    const ipArrayLiteral = ipArray.length > 0
      ? `ARRAY[${ipArray.map(ip => `'${ip}'::cidr`).join(',')}]`
      : 'ARRAY[]::_cidr';

    await prisma.$executeRawUnsafe(`
      UPDATE participations SET
        team_id = $1,
        hidden = $2,
        unrestricted = $3,
        extra_time = ($4 || ' seconds')::interval,
        delay_time = ($5 || ' seconds')::interval,
        password = $6,
        starting_time = $7,
        ip = ${ipArrayLiteral}
      WHERE id = $8
    `, teamId, hidden, unrestricted, extraTime.toString(), delayTime.toString(), password, startingTime, participationId);

    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    console.error('Failed to update participation:', e);
    return { success: false, error: e.message };
  }
}

// Mark user as test user (hidden + unrestricted)
export async function setTestUser(participationId: number) {
  try {
    await prisma.participations.update({
      where: { id: participationId },
      data: {
        hidden: true,
        unrestricted: true,
      },
    });
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Add all team members to a contest
export async function addTeamToContest(
  contestId: number,
  teamId: number,
  options: { hidden?: boolean; unrestricted?: boolean } = {}
) {
  try {
    // Get all users that have participations with this team in any contest
    const teamParticipations = await prisma.participations.findMany({
      where: { team_id: teamId },
      select: { user_id: true },
    });

    // Get unique user IDs
    const userIds = [...new Set(teamParticipations.map((p: { user_id: number }) => p.user_id))];

    if (userIds.length === 0) {
      return { success: false, error: 'No users are associated with this team' };
    }

    // Check which users are already in this contest
    const existingParticipations = await prisma.participations.findMany({
      where: {
        contest_id: contestId,
        user_id: { in: userIds },
      },
      select: { user_id: true },
    });
    const existingUserIds = new Set(existingParticipations.map((p: { user_id: number }) => p.user_id));

    // Filter to users not already in contest
    const newUserIds = userIds.filter(id => !existingUserIds.has(id));

    if (newUserIds.length === 0) {
      return { success: false, error: 'All team members are already in this contest' };
    }

    const hidden = options.hidden ?? false;
    const unrestricted = options.unrestricted ?? false;

    // Add each new user with raw SQL for interval fields
    for (const userId of newUserIds) {
      await prisma.$executeRaw`
        INSERT INTO participations (contest_id, user_id, team_id, hidden, unrestricted, delay_time, extra_time)
        VALUES (${contestId}, ${userId}, ${teamId}, ${hidden}, ${unrestricted}, '0 seconds'::interval, '0 seconds'::interval)
      `;
    }
    
    revalidatePath('/[locale]/contests');
    return { success: true, added: newUserIds.length };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Get participation with interval fields as seconds
export async function getParticipationDetails(id: number) {
  const result = await prisma.$queryRaw<any[]>`
    SELECT 
      id, contest_id, user_id, team_id,
      hidden, unrestricted, password,
      EXTRACT(EPOCH FROM delay_time)::int as delay_time_seconds,
      EXTRACT(EPOCH FROM extra_time)::int as extra_time_seconds,
      starting_time,
      array_to_string(ip, ', ') as ip_string
    FROM participations
    WHERE id = ${id}
  `;

  if (result.length === 0) return null;

  const p = result[0];
  return {
    id: p.id,
    contest_id: p.contest_id,
    user_id: p.user_id,
    team_id: p.team_id,
    hidden: p.hidden,
    unrestricted: p.unrestricted,
    password: p.password,
    delay_time_seconds: p.delay_time_seconds || 0,
    extra_time_seconds: p.extra_time_seconds || 0,
    starting_time: p.starting_time ? new Date(p.starting_time).toISOString().slice(0, 16) : '',
    ip_string: p.ip_string || '',
  };
}

// Send a message to a participant
export async function sendMessage(participationId: number, adminId: number, data: {
  subject: string;
  text: string;
}) {
  try {
    await prisma.messages.create({
      data: {
        participation_id: participationId,
        admin_id: adminId,
        subject: data.subject,
        text: data.text,
        timestamp: new Date(),
      }
    });
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Get messages for a participation
export async function getMessages(participationId: number) {
  return prisma.messages.findMany({
    where: { participation_id: participationId },
    include: { admins: { select: { username: true } } },
    orderBy: { timestamp: 'desc' }
  });
}
