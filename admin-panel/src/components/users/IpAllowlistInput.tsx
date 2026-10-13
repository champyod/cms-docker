'use client';

import { useDictionary } from '@/hooks/useDictionary';

const INPUT_CLASS = 'bg-background/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors';

interface IpAllowlistInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function IpAllowlistInput({ value, onChange }: IpAllowlistInputProps) {
  const ipCopy = useDictionary().participation.ip;
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={ipCopy.placeholder}
      title={ipCopy.label}
      className={INPUT_CLASS}
    />
  );
}
