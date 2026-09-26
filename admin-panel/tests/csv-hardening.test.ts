import { describe, expect, it } from 'vitest';

import { buildPreviewRows, detectFieldMismatches, parseCsv } from '@/components/users/csvPreview';
import { buildEditExportCsv } from '@/components/users/bulkEditActions';
import { csvEscape } from '@/lib/creds-file';

const BOM = '\uFEFF';

describe('parseCsv', () => {
  it('drops a leading BOM instead of folding it into the first header name', () => {
    const rows = parseCsv(`${BOM}first_name,last_name\nAda,Lovelace\n`);

    expect(rows[0]).toEqual(['first_name', 'last_name']);
  });

  it('keeps a BOM-prefixed file fully mappable, header aliases included', () => {
    const { rows, warnings } = buildPreviewRows(`${BOM}first_name,last_name\n${BOM}Ada,Lovelace\n`, 'none');

    expect(warnings).toEqual([]);
    expect(rows[0].first_name).toBe('Ada');
    expect(rows[0].last_name).toBe('Lovelace');
    expect(rows[0].issues.some((issue) => issue.includes('field count'))).toBe(false);
  });

  it('still honours a quoted field containing a comma after a BOM', () => {
    const rows = parseCsv(`${BOM}first_name,last_name\n"Lovelace, Ada",Byron\n`);

    expect(rows[1]).toEqual(['Lovelace, Ada', 'Byron']);
  });
});

describe('detectFieldMismatches', () => {
  it('reports a short row and a long row with their own file positions', () => {
    const rows = parseCsv('first_name,last_name,username\nAda,Lovelace\nAda,Byron,ada99,extra\n');

    expect(detectFieldMismatches(rows)).toEqual([
      { rowIndex: 2, expected: 3, actual: 2 },
      { rowIndex: 3, expected: 3, actual: 4 },
    ]);
  });

  it('returns nothing when every row matches the header width', () => {
    const rows = parseCsv('first_name,last_name\nAda,Lovelace\nAda,Byron\n');

    expect(detectFieldMismatches(rows)).toEqual([]);
  });
});

describe('buildPreviewRows field mismatch reporting', () => {
  it('surfaces the mismatch on the row that caused it, with the row number', () => {
    const { rows, warnings } = buildPreviewRows(
      'first_name,last_name,username,password\nAda,Lovelace,ada99,secret\nAda,Byron\n',
      'none',
    );

    expect(rows[0].rowIndex).toBe(2);
    expect(rows[0].issues).not.toContain('Row 3: expected 4 fields, got 2');
    expect(rows[1].rowIndex).toBe(3);
    expect(rows[1].issues).toContain('Row 3: expected 4 fields, got 2');
    expect(warnings).toContain('1 row(s) have a different field count than the header');
  });

  it('maps a short row by position, so a dropped tail cannot shift later values', () => {
    const { rows } = buildPreviewRows(
      'first_name,last_name,username,password\nAda,Lovelace,ada99,secret\nGrace,Hopper,gh01\n',
      'none',
    );

    expect(rows[1].username).toBe('gh01');
    expect(rows[1].issues).toContain('Row 3: expected 4 fields, got 3');
  });
});

describe('CSV formula injection escaping', () => {
  it.each(['=1+1', '+cmd', '-2+3', '@SUM(A1)', '\tvalue', '\rvalue'])(
    'neutralises a leading %j in the credentials writer',
    (value) => {
      expect(csvEscape(value)).toBe(`"'${value}"`);
    },
  );

  it('leaves an ordinary value byte-identical so the column layout is unchanged', () => {
    expect(csvEscape('ada99')).toBe('ada99');
    expect(csvEscape('Lovelace, Ada')).toBe('"Lovelace, Ada"');
  });

  it('neutralises a leading formula character in the bulk edit writer', () => {
    const csv = buildEditExportCsv([
      { id: 1, first_name: '=HYPERLINK("x")', last_name: 'Byron', username: 'ada99', email: '' },
    ] as Parameters<typeof buildEditExportCsv>[0]);

    // The apostrophe lands inside the quoted cell, so a spreadsheet reads the
    // dangerous value as text while the quote doubling keeps the cell well formed.
    expect(csv.split('\n')[1]).toBe('1,"\'=HYPERLINK(""x"")","Byron","ada99","",""');
  });

  it('keeps the bulk edit header order untouched by the escaping change', () => {
    const csv = buildEditExportCsv([]);

    expect(csv).toBe('id,first_name,last_name,username,password,email\n');
  });
});
