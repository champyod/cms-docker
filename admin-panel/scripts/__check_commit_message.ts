import { readFileSync } from 'node:fs';

const SUBJECT = /^(feat|fix|refactor|perf|test|docs|style|build|ci|chore|revert)(\([a-z0-9/-]+\))?: [a-z].*$/;
const FILLER = /\b(now|currently)\b/i;
const FIRST_PERSON = /^\s*(I|We|we)\b/;
const COMMIT_NARRATION = /\bThis commit\b/i;
const TRAILER = /^(Co-Authored-By|Generated with|Assisted-by):/im;
const PROCESS_FACT = /(Preview at \d+px|Status-colour debt|Gates?:|Tests?:|Full suite|\d+ files \/ \d+ tests)/i;

export function validateCommitMessage(message: string): string[] {
  const lines = message
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !line.startsWith('#'));
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  if (lines.length === 0) return ['message is empty'];

  const errors: string[] = [];
  const subject = lines[0];
  if (subject.length > 50) errors.push(`subject is ${subject.length} characters; maximum is 50`);
  if (!SUBJECT.test(subject)) errors.push('subject must be type(scope): lowercase imperative text');
  if (subject.endsWith('.')) errors.push('subject must not end with a period');

  const body = lines.slice(1);
  for (const line of body) {
    if (line.length > 72) errors.push(`body line is ${line.length} characters; maximum is 72`);
    if (FILLER.test(line)) errors.push(`body uses filler word: ${line}`);
    if (FIRST_PERSON.test(line)) errors.push(`body uses first person: ${line}`);
    if (COMMIT_NARRATION.test(line)) errors.push(`body narrates the commit: ${line}`);
    if (TRAILER.test(line)) errors.push(`body uses a forbidden trailer: ${line}`);
    if (PROCESS_FACT.test(line)) errors.push(`body carries a process fact: ${line}`);
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  const message = path ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8');
  const errors = validateCommitMessage(message);
  if (errors.length > 0) {
    console.error(`commit message rejected:\n- ${errors.join('\n- ')}`);
    process.exitCode = 1;
  }
}
