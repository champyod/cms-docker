/** Bulk testcase upload limits. They live here — not in the server action —
 * because `use server` modules may only export async functions. */
export const MAX_BULK_TESTCASES = 100;
export const MAX_TESTCASE_FILE_BYTES = 2_097_152;
