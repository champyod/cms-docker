import 'server-only';

import { getCaptchaEnv, type CaptchaProvider } from '@/lib/captcha';
import { isProviderHealthy } from '@/lib/captcha-health';

export interface CaptchaProviderStatus {
  readonly provider: CaptchaProvider;
  readonly healthy: boolean;
}

export interface CaptchaStatus {
  readonly enabled: boolean;
  readonly threshold: number;
  readonly banThreshold: number;
  readonly counterStoreReachable: boolean;
  readonly providers: readonly CaptchaProviderStatus[];
}

/**
 * The per-provider health the login path already acts on, plus the thresholds and
 * whether the counter store answered. A provider reads healthy when the store is
 * unreachable, so the reachability flag is what tells an outage from a brute-force run.
 */
export async function readCaptchaStatus(counterStoreReachable: boolean): Promise<CaptchaStatus> {
  const env = getCaptchaEnv();
  const providers = await Promise.all(
    env.providers.map(async (provider) => ({ provider, healthy: await isProviderHealthy(provider) })),
  );
  return {
    enabled: env.enabled,
    threshold: env.threshold,
    banThreshold: env.banThreshold,
    counterStoreReachable,
    providers,
  };
}
