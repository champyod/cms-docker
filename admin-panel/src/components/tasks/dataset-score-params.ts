export interface SubtaskRow {
  maxScore: string;
  testcases: string;
  threshold: string;
}

export const SCORE_PARAM_HELPERS: Record<string, string> = {
  Sum: 'Single integer multiplier applied to the sum of outcomes. Example: 100.',
  GroupMin: 'Rows of [max score, testcases]. Testcases is a count (e.g. 3) or a name regex (e.g. subtask1_.*). Score uses the minimum outcome per subtask.',
  GroupMul: 'Rows of [max score, testcases]. Testcases is a count (e.g. 3) or a name regex (e.g. subtask1_.*). Score uses the product of outcomes per subtask.',
  GroupThreshold: 'Rows of [max score, testcases, threshold]. A subtask scores only when every outcome is in (0, threshold]. Threshold must be in (0, 1].',
};

function toText(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return fallback;
}

export function defaultSubtaskRow(): SubtaskRow {
  return { maxScore: '', testcases: '', threshold: '1' };
}

export function paramsToRows(params: unknown): SubtaskRow[] {
  if (!Array.isArray(params) || params.length === 0) return [defaultSubtaskRow()];
  return params.map((entry) => {
    if (!Array.isArray(entry)) return defaultSubtaskRow();
    const [maxScore, testcases, threshold] = entry as unknown[];
    return {
      maxScore: toText(maxScore, ''),
      testcases: toText(testcases, ''),
      threshold: toText(threshold, '1'),
    };
  });
}

export function rowsToParams(rows: SubtaskRow[], scoreType: string): unknown[] {
  return rows.map((row) => {
    const maxScore = Number(row.maxScore);
    const testcases = /^\d+$/.test(row.testcases.trim()) ? parseInt(row.testcases.trim(), 10) : row.testcases.trim();
    if (scoreType === 'GroupThreshold') return [maxScore, testcases, Number(row.threshold)];
    return [maxScore, testcases];
  });
}

export function lintSubtaskRows(rows: SubtaskRow[], scoreType: string): string {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.maxScore.trim() === '' || Number.isNaN(Number(row.maxScore)) || Number(row.maxScore) < 0) {
      return `Subtask ${index + 1}: max score must be a number >= 0.`;
    }
    if (row.testcases.trim() === '') return `Subtask ${index + 1}: testcases must be a count or a name regex.`;
    if (/^\d+$/.test(row.testcases.trim()) && parseInt(row.testcases.trim(), 10) <= 0) {
      return `Subtask ${index + 1}: testcase count must be > 0.`;
    }
    if (!/^\d+$/.test(row.testcases.trim())) {
      try {
        new RegExp(row.testcases.trim());
      } catch {
        return `Subtask ${index + 1}: invalid regular expression.`;
      }
    }
    if (scoreType === 'GroupThreshold') {
      const threshold = Number(row.threshold);
      if (row.threshold.trim() === '' || Number.isNaN(threshold) || threshold <= 0 || threshold > 1) {
        return `Subtask ${index + 1}: threshold must be in (0, 1].`;
      }
    }
  }
  return '';
}

export function convertScoreParams(params: unknown, fromType: string, toType: string): unknown {
  if (fromType === toType) return params;
  if (toType === 'Sum') {
    if (typeof params === 'number') return params;
    if (Array.isArray(params)) {
      const total = params.reduce<number>((sum, entry) => {
        const maxScore = Array.isArray(entry) ? Number((entry as unknown[])[0]) : NaN;
        return Number.isNaN(maxScore) ? sum : sum + maxScore;
      }, 0);
      return total > 0 ? Math.round(total) : [];
    }
    return [];
  }
  if (fromType === 'Sum' && typeof params === 'number') return [[params, 1]];
  if (Array.isArray(params) && params.length > 0 && Array.isArray(params[0])) {
    return (params as unknown[][]).map((entry) => {
      const [maxScore, testcases, threshold] = entry;
      if (toType === 'GroupThreshold') return [maxScore, testcases, threshold ?? 1];
      return [maxScore, testcases];
    });
  }
  return [];
}
