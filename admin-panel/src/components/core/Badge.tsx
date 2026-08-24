import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest',
  {
    variants: {
      variant: {
        indigo: 'border-primary/20 bg-primary/10 text-primary',
        cyan: 'border-info/20 bg-info/10 text-info',
        emerald: 'border-success/20 bg-success/10 text-success',
        amber: 'border-warning/20 bg-warning/10 text-warning',
        red: 'border-destructive/20 bg-destructive/10 text-destructive',
        neutral: 'border-border bg-secondary text-muted-foreground',
        success: 'border-success/20 bg-success/10 text-success',
        warning: 'border-warning/20 bg-warning/10 text-warning',
        info: 'border-info/20 bg-info/10 text-info',
        destructive: 'border-destructive/20 bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: {
      variant: 'indigo',
    },
  }
);

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: React.ReactNode;
  className?: string;
}

export function Badge({ children, variant = 'indigo', className }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)}>
      {children}
    </span>
  );
}
