'use client';

import { useState, useEffect } from 'react';
import { getCoreServicesStatus } from '@/app/actions/docker-ops';
import { Card } from '@/components/core/Card';
import { SkeletonText } from '@/components/core/Skeleton';
import { EmptyState } from '@/components/core/EmptyState';
import { ShieldCheck, Circle, Server } from 'lucide-react';

interface ServiceStatus {
  name: string;
  status: string;
}

export function CoreServicesStatus() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const result = await getCoreServicesStatus();
      if (result.success) {
        setServices(result.services);
      }
    } catch (error) {
      console.error('Failed to fetch core services status:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'running':
        return 'text-emerald-400';
      case 'starting':
        return 'text-blue-400';
      case 'unhealthy':
        return 'text-amber-400';
      case 'stopped':
      default:
        return 'text-red-400';
    }
  };

  const getStatusLabel = (status: string) => {
    return status.toUpperCase();
  };

  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <h2 className="text-lg font-bold text-foreground">Core Services</h2>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="py-4"><SkeletonText lines={4} /></div>
        ) : services.length === 0 ? (
          <EmptyState icon={Server} title="No services found" />
        ) : (
          services.map((service) => (
            <div key={service.name} className="flex justify-between items-center text-sm py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
              <span className="text-muted-foreground text-xs font-mono truncate flex-1">{service.name.replace('cms-', '')}</span>
              <div className="flex items-center gap-2">
                <Circle className={`w-2 h-2 fill-current ${getStatusColor(service.status)}`} />
                <span className={`font-medium text-xs ${getStatusColor(service.status)}`}>
                  {getStatusLabel(service.status)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
