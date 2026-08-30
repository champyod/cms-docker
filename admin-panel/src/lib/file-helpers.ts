export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = (error): void => {
      reject(error);
    };
    reader.readAsDataURL(file);
  });
}

export function readBytesAsBase64(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(new Blob([bytes.buffer as ArrayBuffer]));
    reader.onload = (): void => {
      const result = reader.result as string;
      if (typeof result === 'string') {
        resolve(result.split(',')[1] ?? '');
      } else {
        reject(new Error('Failed to convert file'));
      }
    };
    reader.onerror = (error): void => {
      reject(error);
    };
  });
}
