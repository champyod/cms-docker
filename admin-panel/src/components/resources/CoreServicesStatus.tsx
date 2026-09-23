'use client';

import { Card } from '@/components/core/Card';
import { SkeletonText } from '@/components/core/Skeleton';
import { EmptyState } from '@/components/core/EmptyState';
import { StatusPill } from '@/components/core/StatusPill';
import { ShieldCheck, Server } from 'lucide-react';
import type { CoreServiceStatus } from '@/lib/live-frames';

interface CoreServicesStatusProps {
  services: CoreServiceStatus[];
  loading: boolean;
}

/**
 * Why the list arrives as a prop: it is one section of the resources stream, so this card no longer
 * owns a timer of its own — the page's single connection carries it.
 */
export function CoreServicesStatus({ services, loading }: CoreServicesStatusProps): React.JSX.Element {
  return (
    <Card className="p-6 density:p-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <h2 className="text-lg font-bold text-foreground">Core Services</h2>
      </div>

      <div className="space-y-2 density:space-y-1">
        {loading ? (
          <div className="py-4"><SkeletonText lines={4} /></div>
        ) : services.length === 0 ? (
          <EmptyState icon={Server} title="No services found" />
        ) : (
          services.map((service) => (
            <div key={service.name} className="flex justify-between items-center text-sm py-2 density:py-1 px-3 density:px-2 rounded-lg hover:bg-muted/50 transition-colors">
              <span className="text-muted-foreground text-xs font-mono truncate flex-1">{service.name.replace('cms-', '')}</span>
              <StatusPill status={service.status} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
