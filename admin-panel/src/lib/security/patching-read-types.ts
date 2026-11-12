import type { security_findings, security_waivers } from '@prisma/client';

import type { PatchingCards, PatchingWaiver } from '@/lib/security/patching';
import type { SecurityDigest } from '@/lib/security/signal';

/** A row of the findings table, as Prisma returns it. */
export type FindingRow = security_findings;

/** A row of the waiver table, as Prisma returns it. */
export type WaiverRow = security_waivers;

/** The numbers the overview cards and the signal job render, plus the one digest derived from them. */
export interface PatchingSnapshot {
  readonly waivers: readonly PatchingWaiver[];
  readonly cards: PatchingCards;
  readonly signal: SecurityDigest;
}

/** One unresolved row the bulk waiver judges: the columns the decision needs and nothing else. */
export interface BulkWaiveCandidate {
  readonly id: number;
  readonly key: string;
  readonly title: string | null;
  readonly host: string | null;
  readonly reachability: string;
}

/** One live decision: what it covers and the source it covers it for. */
export interface BulkWaiveWaiver {
  readonly source: string;
  readonly match: string;
  readonly ended_at: Date | null;
}

/** The feed the bulk waiver plans over: every candidate row, and every decision already standing. */
export interface BulkWaiveFeed {
  readonly rows: readonly BulkWaiveCandidate[];
  readonly waivers: readonly BulkWaiveWaiver[];
}

/** The slice of the feed a completed scan's message describes: who spoke, for which box, and when. */
export interface ScanScope {
  readonly source: string;
  readonly host: string | null;
  readonly runStartedAt: Date;
}
