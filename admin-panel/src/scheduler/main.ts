import { startScheduler } from '@/scheduler/runner';

/**
 * Process entry point for the poller image. `runner.ts` stays importable, so
 * nothing but this file can start the polling loop.
 */
startScheduler();
