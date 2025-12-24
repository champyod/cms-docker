'use client';

import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, Check } from 'lucide-react';

export interface Option {
  value: string;
  label: string;
}

interface SelectorProps {
  options: Option[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}

export const Selector: React.FC<SelectorProps> = ({
  options,
  value,
  onChange,
  placeholder = "Select an option",
  label,
  className,
  disabled
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={cn("space-y-1.5 w-full", className)} ref={containerRef}>
      {label && (
        <label className="text-sm font-medium text-slate-300 ml-1">
          {label}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={cn(
            "glass-input w-full flex items-center justify-between cursor-pointer text-left",
            !selectedOption && "text-slate-400",
            disabled && "opacity-50 cursor-not-allowed",
            isOpen && "ring-2 ring-indigo-500/50 border-indigo-500/50"
          )}
        >
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", isOpen && "rotate-180")} />
        </button>

        {isOpen && (
          <div className="absolute z-50 w-full mt-2 overflow-hidden bg-[#0f172a]/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-xl max-h-60 overflow-y-auto">
            <div className="p-1">
              {options.map((option) => (
                <div
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm",
                    option.value === value
                      ? "bg-indigo-600/20 text-indigo-200"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {option.value === value && (
                    <Check className="w-3.5 h-3.5 text-indigo-400" />
                  )}
                </div>
              ))}
              {options.length === 0 && (
                <div className="px-3 py-2 text-sm text-slate-500 text-center">
                  No options
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
