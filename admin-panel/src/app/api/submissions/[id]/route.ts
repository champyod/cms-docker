import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('contests');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = await req.json();
    const { action } = data;

    if (action === 'comment') {
       await prisma.submissions.update({ where: { id }, data: { comment: data.comment } });
    } else if (action === 'toggle-official') {
       const sub = await prisma.submissions.findUnique({ where: { id } });
       if (!sub) return apiError({ message: 'Submission not found', status: 404 });
       await prisma.submissions.update({ where: { id }, data: { official: !sub.official } });
    } else if (action === 'recalculate') {
       const type = data.type || 'score';
       if (type === 'evaluation' || type === 'full') {
         await prisma.evaluations.deleteMany({ where: { submission_id: id } });
       }
       if (type === 'score' || type === 'full') {
         await prisma.submission_results.deleteMany({ where: { submission_id: id } });
       }
    } else {
       return apiError({ message: 'Invalid action', status: 400 });
    }

    revalidatePath('/[locale]/submissions', 'page');
    return apiSuccess({ message: 'Submission updated successfully' });
  } catch (error: any) {
    return apiError(error);
  }
}
