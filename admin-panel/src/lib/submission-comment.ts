export const MAX_SUBMISSION_COMMENT_LENGTH = 2000;

/** Appends a canned comment as its own paragraph, so a quick pick never overwrites a draft. */
export function appendCommentSnippet(current: string, snippet: string): string {
  const trimmed = current.trimEnd();
  return trimmed === '' ? snippet : trimmed + '\n' + snippet;
}
