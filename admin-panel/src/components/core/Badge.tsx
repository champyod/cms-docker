import { Badge as AdapterBadge, type BadgeVariantProps } from '@/components/ui/badge';

type BadgeProps = BadgeVariantProps & {
  children: React.ReactNode;
  className?: string;
  title?: string;
};

export function Badge({ children, variant = 'indigo', className, title }: BadgeProps): React.JSX.Element {
  return (
    <AdapterBadge variant={variant} className={className} title={title}>
      {children}
    </AdapterBadge>
  );
}
