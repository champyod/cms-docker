import { Badge as AdapterBadge, type BadgeVariantProps } from '@/components/ui/badge';

type BadgeProps = BadgeVariantProps & {
  children: React.ReactNode;
  className?: string;
};

export function Badge({ children, variant = 'indigo', className }: BadgeProps): React.JSX.Element {
  return (
    <AdapterBadge variant={variant} className={className}>
      {children}
    </AdapterBadge>
  );
}
