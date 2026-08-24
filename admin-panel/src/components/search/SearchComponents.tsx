import { Card } from '@/components/core/Card';
import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';
import React from 'react';

interface SearchResultCardProps {
  title: string;
  subtitle?: string;
  className?: string;
}

export function SearchResultCard({ title, subtitle, className }: SearchResultCardProps) {
  return (
    <Card className={cn("p-4 hover:bg-accent/50 transition-colors cursor-pointer", className)}>
      <div className="font-bold text-foreground">{title}</div>
      {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
    </Card>
  );
}

interface SectionHeaderProps {
  title: string;
  count?: number;
  icon?: LucideIcon;
  iconColor?: string;
}

export function SectionHeader({ title, count, icon: Icon, iconColor }: SectionHeaderProps) {
  return (
    <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
      {Icon && <Icon className={cn("w-5 h-5", iconColor)} />}
      {title}
      {count !== undefined && <span className="text-muted-foreground text-base font-normal">({count})</span>}
    </h2>
  );
}
