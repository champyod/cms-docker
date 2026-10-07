import { describe, expect, it } from 'vitest';
import { stripDisallowedFields } from '@/lib/field-permissions';

const CREATE_FIELDS = { codename: '0', public: false, input: 'digest-in', output: 'digest-out' };

describe('testcase creation field gate', () => {
  it('keeps all creation fields for testcase:update holders', () => {
    const allowed = stripDisallowedFields(
      'testcases',
      { ...CREATE_FIELDS },
      new Set(['testcase:create', 'testcase:read', 'testcase:update']),
    );
    expect(allowed).toEqual(CREATE_FIELDS);
  });

  it('removes creation fields without testcase:update', () => {
    const allowed = stripDisallowedFields('testcases', { ...CREATE_FIELDS }, new Set(['testcase:create']));
    expect(allowed.codename).toBeUndefined();
    expect(allowed.input).toBeUndefined();
    expect(allowed.output).toBeUndefined();
  });
});
