import { prisma } from '@/lib/prisma';
import { PERMISSION_REGISTRY } from '@/lib/permission-registry';
import { DEFAULT_GROUPS } from '@/lib/permission-groups';

interface SeedSummary {
  permissionsUpserted: number;
  groupsUpserted: number;
  linksAdded: number;
  linksRemoved: number;
}

function findMissingPermissionKeys(): string[] {
  const registryKeys = new Set(PERMISSION_REGISTRY.map((definition) => definition.key));
  const missing: string[] = [];
  for (const group of DEFAULT_GROUPS) {
    for (const key of group.permissions) {
      if (!registryKeys.has(key)) missing.push(`${group.name} -> ${key}`);
    }
  }
  return missing;
}

async function seed(): Promise<SeedSummary> {
  const missing = findMissingPermissionKeys();
  if (missing.length > 0) {
    throw new Error(
      `Seed aborted: ${missing.length} group permission(s) are not in PERMISSION_REGISTRY:\n  ${missing.join('\n  ')}`,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      let permissionsUpserted = 0;
      const permissionIdByKey = new Map<string, number>();
      for (const definition of PERMISSION_REGISTRY) {
        const permission = await tx.permissions.upsert({
          where: { key: definition.key },
          update: {
            module: definition.module,
            verb: definition.verb,
            description: definition.description,
          },
          create: {
            key: definition.key,
            module: definition.module,
            verb: definition.verb,
            description: definition.description,
          },
          select: { id: true },
        });
        permissionIdByKey.set(definition.key, permission.id);
        permissionsUpserted += 1;
      }

      let groupsUpserted = 0;
      let linksAdded = 0;
      let linksRemoved = 0;

      for (const groupDefinition of DEFAULT_GROUPS) {
        const group = await tx.groups.upsert({
          where: { name: groupDefinition.name },
          update: { description: groupDefinition.description, is_seeded: true },
          create: {
            name: groupDefinition.name,
            description: groupDefinition.description,
            is_seeded: true,
          },
          select: { id: true },
        });
        groupsUpserted += 1;

        const desiredPermissionIds = new Set<number>();
        for (const key of groupDefinition.permissions) {
          const permissionId = permissionIdByKey.get(key);
          if (permissionId === undefined) {
            throw new Error(
              `Seed aborted: permission "${key}" was not seeded before group "${groupDefinition.name}".`,
            );
          }
          desiredPermissionIds.add(permissionId);
        }

        const existingLinks = await tx.group_permissions.findMany({
          where: { group_id: group.id },
          select: { permission_id: true },
        });
        const existingPermissionIds = new Set(existingLinks.map((link) => link.permission_id));

        const missingIds = [...desiredPermissionIds].filter((id) => !existingPermissionIds.has(id));
        const surplusIds = [...existingPermissionIds].filter((id) => !desiredPermissionIds.has(id));

        // Why: reconcile only this seeded group's surplus links (never the group row, never
        // links owned by other groups) so repeated runs converge on the registry without
        // erasing manual grants made elsewhere in a live database.
        if (surplusIds.length > 0) {
          const removed = await tx.group_permissions.deleteMany({
            where: { group_id: group.id, permission_id: { in: surplusIds } },
          });
          linksRemoved += removed.count;
        }

        if (missingIds.length > 0) {
          const added = await tx.group_permissions.createMany({
            data: missingIds.map((permission_id) => ({ group_id: group.id, permission_id })),
          });
          linksAdded += added.count;
        }
      }

      return { permissionsUpserted, groupsUpserted, linksAdded, linksRemoved };
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
}

seed()
  .then((summary) => {
    console.log(
      `Seed complete: ${summary.permissionsUpserted} permissions upserted, ` +
        `${summary.groupsUpserted} groups upserted, ${summary.linksAdded} links added, ` +
        `${summary.linksRemoved} links removed.`,
    );
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
