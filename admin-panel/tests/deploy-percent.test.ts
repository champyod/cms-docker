import { describe, expect, it } from 'vitest';
import { parseDeployPercent } from '@/lib/deploy-percent.shared';

describe('parseDeployPercent', () => {
  it('reports the latest figure, not the running maximum of the whole log', () => {
    const log = 'Step 1/5\nProgress: [########] 100%\nStep 2/5\nDownloading packages 25%\n';
    expect(parseDeployPercent(log)).toBe(25);
  });

  it('never reports 100 from an in-flight log line', () => {
    expect(parseDeployPercent('Package download [########] 100%\n')).toBeNull();
  });

  it('stops reporting 100 once unrelated output follows it', () => {
    const log = '=> => exporting layer 100%\n#7 DONE 12.3s\n#8 [4/6] RUN npm ci\n';
    expect(parseDeployPercent(log)).toBeNull();
  });

  it('reports plain monotonic progress', () => {
    expect(parseDeployPercent('10% ... 60%')).toBe(60);
  });

  it('treats zero and missing figures as indeterminate', () => {
    expect(parseDeployPercent('Progress: 0%')).toBeNull();
    expect(parseDeployPercent('no percentage here')).toBeNull();
    expect(parseDeployPercent('')).toBeNull();
  });
});
