import { describe, expect, it } from 'vitest';
import {
  defaultTaskTypeFields,
  defaultTaskTypeParams,
  fieldsToTaskTypeParams,
  lintTaskTypeFields,
  taskTypeParamsToFields,
} from '@/components/tasks/dataset-tasktype-params';

describe('taskTypeParamsToFields', () => {
  it('maps the three Batch parameters, flattening the I/O collection', () => {
    expect(taskTypeParamsToFields(['grader', ['in.txt', 'out.txt'], 'comparator'], 'Batch')).toEqual({
      compilation: 'grader',
      inputfile: 'in.txt',
      outputfile: 'out.txt',
      output_eval: 'comparator',
    });
  });

  it('falls back to per-type defaults when the parameters are empty', () => {
    expect(taskTypeParamsToFields([], 'Batch')).toEqual({
      compilation: 'alone',
      inputfile: '',
      outputfile: '',
      output_eval: 'diff',
    });
    expect(taskTypeParamsToFields(undefined, 'Communication')).toEqual({
      num_processes: '1',
      compilation: 'alone',
      user_io: 'std_io',
    });
  });

  it('falls back to defaults for slots that are missing or the wrong shape', () => {
    expect(taskTypeParamsToFields(['alone', 'diff'], 'Batch')).toEqual({
      compilation: 'alone',
      inputfile: '',
      outputfile: '',
      output_eval: 'diff',
    });
    expect(taskTypeParamsToFields(['alone', ['in.txt'], 'diff'], 'Batch')).toEqual({
      compilation: 'alone',
      inputfile: 'in.txt',
      outputfile: '',
      output_eval: 'diff',
    });
  });

  it('keeps a non-string I/O value out of the fields', () => {
    expect(taskTypeParamsToFields(['alone', [7, null], 'diff'], 'Batch')).toEqual({
      compilation: 'alone',
      inputfile: '',
      outputfile: '',
      output_eval: 'diff',
    });
  });

  it('has no fields for an unknown task type', () => {
    expect(taskTypeParamsToFields(['diff'], 'Interactive')).toEqual({});
  });
});

describe('fieldsToTaskTypeParams', () => {
  it('rebuilds the three Batch parameters with a two-element I/O list', () => {
    const params = ['grader', ['in.txt', 'out.txt'], 'comparator'];
    const fields = taskTypeParamsToFields(params, 'Batch');
    expect(fieldsToTaskTypeParams(fields, 'Batch')).toEqual(params);
  });

  it('round-trips blank I/O names as stdin and stdout', () => {
    const fields = { compilation: 'alone', inputfile: '', outputfile: '', output_eval: 'diff' };
    expect(fieldsToTaskTypeParams(fields, 'Batch')).toEqual(['alone', ['', ''], 'diff']);
  });

  it('rebuilds the single OutputOnly and TwoSteps parameter', () => {
    for (const taskType of ['OutputOnly', 'TwoSteps']) {
      expect(fieldsToTaskTypeParams({ output_eval: 'comparator' }, taskType)).toEqual(['comparator']);
    }
  });

  it('rebuilds Communication with the process count as an integer', () => {
    const fields = { num_processes: '2', compilation: 'stub', user_io: 'fifo_io' };
    expect(fieldsToTaskTypeParams(fields, 'Communication')).toEqual([2, 'stub', 'fifo_io']);
  });

  it('trims surrounding whitespace', () => {
    const fields = { num_processes: ' 1 ', compilation: ' alone ', user_io: 'std_io' };
    expect(fieldsToTaskTypeParams(fields, 'Communication')).toEqual([1, 'alone', 'std_io']);
  });

  it('refuses to build parameters for an incomplete, invalid, or unknown type', () => {
    expect(fieldsToTaskTypeParams({ compilation: 'alone', output_eval: 'diff' }, 'Batch')).toBeNull();
    expect(fieldsToTaskTypeParams({ compilation: 'stub', inputfile: '', outputfile: '', output_eval: 'diff' }, 'Batch')).toBeNull();
    expect(fieldsToTaskTypeParams({ output_eval: 'diff' }, 'Interactive')).toBeNull();
  });
});

describe('defaultTaskTypeParams', () => {
  it('matches the parameters a worker receives when nothing was stored', () => {
    expect(defaultTaskTypeParams('Batch')).toEqual(['alone', ['', ''], 'diff']);
    expect(defaultTaskTypeParams('OutputOnly')).toEqual(['diff']);
    expect(defaultTaskTypeParams('TwoSteps')).toEqual(['diff']);
    expect(defaultTaskTypeParams('Communication')).toEqual([1, 'alone', 'std_io']);
    expect(defaultTaskTypeParams('Interactive')).toBeNull();
  });

  it('is what the visual fields start from', () => {
    expect(defaultTaskTypeFields('Batch')).toEqual({
      compilation: 'alone',
      inputfile: '',
      outputfile: '',
      output_eval: 'diff',
    });
  });
});

describe('lintTaskTypeFields', () => {
  it('accepts a valid field set for every task type', () => {
    expect(lintTaskTypeFields({ compilation: 'alone', inputfile: '', outputfile: '', output_eval: 'diff' }, 'Batch')).toBe('');
    expect(lintTaskTypeFields({ output_eval: 'diff' }, 'OutputOnly')).toBe('');
    expect(lintTaskTypeFields({ output_eval: 'diff' }, 'TwoSteps')).toBe('');
    expect(lintTaskTypeFields({ num_processes: '1', compilation: 'alone', user_io: 'std_io' }, 'Communication')).toBe('');
  });

  it('reports the wrong parameter count', () => {
    expect(lintTaskTypeFields({ compilation: 'alone', output_eval: 'diff' }, 'Batch'))
      .toContain('expects 4 parameters; missing inputfile, outputfile');
    expect(lintTaskTypeFields({ output_eval: 'diff', num_processes: '1' }, 'Communication'))
      .toContain('missing compilation, user_io');
  });

  it('rejects a choice outside the task type options', () => {
    expect(lintTaskTypeFields({ compilation: 'stub', inputfile: '', outputfile: '', output_eval: 'diff' }, 'Batch'))
      .toBe('Compilation must be one of: alone, grader.');
    expect(lintTaskTypeFields({ num_processes: '1', compilation: 'grader', user_io: 'std_io' }, 'Communication'))
      .toBe('Compilation must be one of: alone, stub.');
    expect(lintTaskTypeFields({ output_eval: 'white_diff' }, 'TwoSteps'))
      .toBe('Output evaluation must be one of: diff, comparator.');
  });

  it('rejects an empty choice but accepts blank I/O names', () => {
    expect(lintTaskTypeFields({ compilation: 'alone', inputfile: '', outputfile: '', output_eval: '  ' }, 'Batch'))
      .toBe('Output evaluation is required.');
    expect(lintTaskTypeFields({ compilation: 'alone', inputfile: '', outputfile: '', output_eval: 'diff' }, 'Batch')).toBe('');
  });

  it('rejects a process count that is not an integer', () => {
    for (const value of ['', ' ', '1.5', 'two', '1e3']) {
      expect(lintTaskTypeFields({ num_processes: value, compilation: 'alone', user_io: 'std_io' }, 'Communication'))
        .toBe('Number of processes must be an integer.');
    }
  });

  it('fails closed on an unknown task type', () => {
    expect(lintTaskTypeFields({ output_eval: 'diff' }, 'Interactive')).toBe('Unknown task type "Interactive".');
    expect(lintTaskTypeFields({}, '')).toContain('Unknown task type');
  });
});
