import { prisma } from '@/lib/prisma';
import { storeFile } from '@/lib/fsobjects';
import {
  formatByteLimit,
  MAX_BULK_TESTCASES,
  MAX_TESTCASE_FILE_BYTES,
  MAX_TESTCASE_UPLOAD_BYTES,
} from '@/lib/testcase-limits';

/** Expected upload failure carrying an HTTP status so apiError() can surface the message to the client. */
export class TestcaseUploadError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TestcaseUploadError';
    this.status = status;
  }
}

export interface TestcaseUploadPair {
  codename: string;
  input: File;
  output: File;
}

// Codenames reach the DB and score-type regexes (e.g. subtask1_.*); keep them
// to the character set the filename parsers can produce.
const MAX_CODENAME_LENGTH = 255;
const CODENAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface TestcaseUpload {
  datasetId: number;
  pairs: TestcaseUploadPair[];
}

function parsePair(formData: FormData, index: number): TestcaseUploadPair {
  const codename = formData.get(`codename-${index}`);
  const input = formData.get(`input-${index}`);
  const output = formData.get(`output-${index}`);

  if (typeof codename !== 'string' || codename.length === 0) {
    throw new TestcaseUploadError(`Every testcase needs a codename (pair ${index + 1})`, 400);
  }
  if (codename.length > MAX_CODENAME_LENGTH || !CODENAME_PATTERN.test(codename)) {
    throw new TestcaseUploadError(
      `Invalid codename "${codename.slice(0, 64)}": use 1-${MAX_CODENAME_LENGTH} characters of letters, digits, dot, underscore or dash`,
      400,
    );
  }
  if (!(input instanceof File) || !(output instanceof File)) {
    throw new TestcaseUploadError(`Missing input or output file for pair "${codename}"`, 400);
  }
  if (input.size === 0 || output.size === 0) {
    throw new TestcaseUploadError(`Empty file for pair "${codename}"`, 400);
  }
  if (input.size > MAX_TESTCASE_FILE_BYTES || output.size > MAX_TESTCASE_FILE_BYTES) {
    throw new TestcaseUploadError(`Testcase "${codename}" exceeds the ${formatByteLimit(MAX_TESTCASE_FILE_BYTES)} per-file limit`, 413);
  }

  return { codename, input, output };
}

/** Validates a multipart testcase payload (indexed field names) before any file is read into memory. */
export function parseTestcaseFormData(formData: FormData): TestcaseUpload {
  const datasetId = Number(formData.get('datasetId'));
  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    throw new TestcaseUploadError('Invalid dataset', 400);
  }

  const count = Number(formData.get('count'));
  if (!Number.isInteger(count) || count < 1) {
    throw new TestcaseUploadError('No testcases provided', 400);
  }
  if (count > MAX_BULK_TESTCASES) {
    throw new TestcaseUploadError(`Too many testcases: limit is ${MAX_BULK_TESTCASES} per upload`, 400);
  }

  let totalBytes = 0;
  const pairs: TestcaseUploadPair[] = [];

  for (let index = 0; index < count; index += 1) {
    const pair = parsePair(formData, index);
    totalBytes += pair.input.size + pair.output.size;
    if (totalBytes > MAX_TESTCASE_UPLOAD_BYTES) {
      throw new TestcaseUploadError(`Upload exceeds the ${formatByteLimit(MAX_TESTCASE_UPLOAD_BYTES)} total limit`, 413);
    }
    pairs.push(pair);
  }

  return { datasetId, pairs };
}

export async function persistTestcasePair(datasetId: number, pair: TestcaseUploadPair): Promise<'created' | 'skipped'> {
  // Why the pre-check: skip codenames that already exist before storing blobs,
  // so a re-upload never writes orphaned large objects.
  const existing = await prisma.testcases.findUnique({
    where: { dataset_id_codename: { dataset_id: datasetId, codename: pair.codename } },
    select: { id: true },
  });
  if (existing) {
    console.warn(`Testcase ${pair.codename} already exists, skipping.`);
    return 'skipped';
  }

  const inputDigest = await storeFile(Buffer.from(await pair.input.arrayBuffer()));
  const outputDigest = await storeFile(Buffer.from(await pair.output.arrayBuffer()));

  try {
    await prisma.testcases.create({
      data: {
        dataset_id: datasetId,
        codename: pair.codename,
        input: inputDigest,
        output: outputDigest,
        public: false,
      },
    });
    return 'created';
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!message.toLowerCase().includes('unique constraint')) {
      throw error;
    }
    console.warn(`Testcase ${pair.codename} already exists, skipping.`);
    return 'skipped';
  }
}
