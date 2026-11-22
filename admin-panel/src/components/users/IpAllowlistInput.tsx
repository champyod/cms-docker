'use client';

import { useDictionary } from '@/hooks/useDictionary';
import { fieldClasses } from '@/components/core/fieldStyles';

const INPUT_CLASS = fieldClasses(false);

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
