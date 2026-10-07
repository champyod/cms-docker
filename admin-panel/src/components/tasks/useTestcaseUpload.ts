'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { FileEncoding } from '@/lib/file-encoding';
import { validatePattern } from '@/utils/filenameParser';
import { pairLocalFiles, pairZipFile } from './testcase-upload';
import type { FilePair } from './testcase-helpers';

interface SelectedFiles {
  uploadType: 'files' | 'zip';
  files: File[];
}

export interface TestcaseUploadState {
  uploadType: 'files' | 'zip';
  setUploadType: (value: 'files' | 'zip') => void;
  inputPattern: string;
  outputPattern: string;
  inputPatternError: string;
  outputPatternError: string;
  patternsPasted: boolean;
  pairs: FilePair[];
  processing: boolean;
  markPatternsPasted: () => void;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePatternChange: (side: 'input' | 'output', value: string) => void;
  updatePairEncoding: (pairId: string, side: 'input' | 'output', encoding: FileEncoding) => void;
}

export function useTestcaseUpload(isOpen: boolean): TestcaseUploadState {
  const [uploadType, setUploadType] = useState<'files' | 'zip'>('files');
  const [inputPattern, setInputPattern] = useState('*.in');
  const [outputPattern, setOutputPattern] = useState('*.out');
  const [inputPatternError, setInputPatternError] = useState('');
  const [outputPatternError, setOutputPatternError] = useState('');
  const [patternsPasted, setPatternsPasted] = useState(false);
  const [pairs, setPairs] = useState<FilePair[]>([]);
  const [processing, setProcessing] = useState(false);
  const pastedPatternsRef = useRef(false);
  const selectedFilesRef = useRef<SelectedFiles | null>(null);

  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (isOpen) {
      setUploadType('files');
      setInputPattern('*.in');
      setOutputPattern('*.out');
      setInputPatternError('');
      setOutputPatternError('');
      setPatternsPasted(false);
      setPairs([]);
      setProcessing(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    pastedPatternsRef.current = false;
    selectedFilesRef.current = null;
  }, [isOpen]);

  const processFilesList = async (files: File[]): Promise<void> => {
    setProcessing(true);
    try {
      setPairs(await pairLocalFiles(files, inputPattern, outputPattern));
    } catch (error) {
      console.error('Failed to process files:', error);
      toast.error('Failed to process files');
    } finally {
      setProcessing(false);
    }
  };

  const processZip = async (file: File): Promise<void> => {
    setProcessing(true);
    try {
      setPairs(await pairZipFile(file, inputPattern, outputPattern));
    } catch (error) {
      console.error('Failed to process zip file:', error);
      toast.error('Failed to process zip file');
    } finally {
      setProcessing(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    if (!e.target.files?.length) return;
    const files = Array.from(e.target.files);
    selectedFilesRef.current = { uploadType, files };
    if (uploadType === 'zip') void processZip(files[0]);
    else void processFilesList(files);
  };

  const markPatternsPasted = (): void => {
    pastedPatternsRef.current = true;
  };

  const handlePatternChange = (side: 'input' | 'output', value: string): void => {
    const setValue = side === 'input' ? setInputPattern : setOutputPattern;
    const setLint = side === 'input' ? setInputPatternError : setOutputPatternError;
    if (pastedPatternsRef.current) {
      pastedPatternsRef.current = false;
      setPatternsPasted(true);
      setValue(value);
      setLint('');
      return;
    }
    setPatternsPasted(false);
    setValue(value);
    setLint(validatePattern(value));
  };

  // Why the guard: a pattern edit must re-pair the already selected
  // files, but only when the new patterns lint clean.
  useEffect(() => {
    const selection = selectedFilesRef.current;
    if (!selection || inputPatternError || outputPatternError) return;
    const rebuildPairs = async (): Promise<void> => {
      setProcessing(true);
      try {
        setPairs(selection.uploadType === 'zip'
          ? await pairZipFile(selection.files[0], inputPattern, outputPattern)
          : await pairLocalFiles(selection.files, inputPattern, outputPattern));
      } catch (error) {
        console.error('Failed to process files:', error);
        toast.error('Failed to process files');
      } finally {
        setProcessing(false);
      }
    };
    void rebuildPairs();
  }, [inputPattern, outputPattern, inputPatternError, outputPatternError]);

  const updatePairEncoding = (pairId: string, side: 'input' | 'output', encoding: FileEncoding): void => {
    setPairs((previous) =>
      previous.map((pair) => {
        if (pair.id !== pairId) return pair;
        const next = { ...pair };
        const target = side === 'input' ? next.inputFile : next.outputFile;
        if (target) target.selectedEncoding = encoding;
        return next;
      })
    );
  };

  return {
    uploadType,
    setUploadType,
    inputPattern,
    outputPattern,
    inputPatternError,
    outputPatternError,
    patternsPasted,
    pairs,
    processing,
    markPatternsPasted,
    handleFileSelect,
    handlePatternChange,
    updatePairEncoding,
  };
}
