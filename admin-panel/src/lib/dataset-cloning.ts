import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export type DatasetRecord = Prisma.datasetsGetPayload<Record<string, never>>;

type DatasetWithRelations = Prisma.datasetsGetPayload<{
  include: { testcases: true; managers: true };
}>;

async function copyTestcases(datasetId: number, testcases: DatasetWithRelations['testcases']): Promise<void> {
  for (const tc of testcases) {
    await prisma.testcases.create({
      data: {
        dataset_id: datasetId,
        codename: tc.codename,
        public: tc.public,
        input: tc.input,
        output: tc.output,
      },
    });
  }
}

async function copyManagers(datasetId: number, managers: DatasetWithRelations['managers']): Promise<void> {
  for (const mgr of managers) {
    await prisma.managers.create({
      data: {
        dataset_id: datasetId,
        filename: mgr.filename,
        digest: mgr.digest,
      },
    });
  }
}

export async function cloneDatasetRecords(
  original: DatasetWithRelations,
  newDescription: string
): Promise<DatasetRecord> {
  const newDataset = await prisma.datasets.create({
    data: {
      task_id: original.task_id,
      description: newDescription,
      time_limit: original.time_limit,
      memory_limit: original.memory_limit,
      task_type: original.task_type,
      task_type_parameters: original.task_type_parameters as Prisma.InputJsonValue,
      score_type: original.score_type,
      score_type_parameters: original.score_type_parameters as Prisma.InputJsonValue,
      autojudge: false,
    },
  });

  await copyTestcases(newDataset.id, original.testcases);
  await copyManagers(newDataset.id, original.managers);

  return newDataset;
}
