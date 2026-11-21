'use client';

import { useDraggable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SubtaskChip({ codename }: { codename: string }): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: codename });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
  return (
    <span
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      title={codename}
      className={cn(
        'inline-flex cursor-grab items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-xs text-foreground transition-colors hover:border-ring active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground" />
      {codename}
    </span>
  );
}
