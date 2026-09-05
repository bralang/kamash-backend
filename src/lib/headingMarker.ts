/** Prefix that marks a top-level group heading as it travels between two pipeline stages.
 *
 * The per-section rewrite (`anthropicService.rewriteSection`) emits plain text; heading levels
 * are only assigned later, when `htmlConversionService.sectionToHtml` turns that text into
 * markup. With nothing to go on, that stage infers the hierarchy — and it does so
 * inconsistently: two real diagnoses ran the same "תוכנית עבודה למורה" section through the
 * same prompt, and one came back correctly nested (h3 groups over h4 children) while the other
 * flattened all eighteen headings to h3.
 *
 * A section's closed sub-heading list (the "כותרות משנה מותרות" config-sheet column) may
 * therefore mark its group headings with this prefix. The rewrite carries the prefix through to
 * its output, the HTML stage maps a prefixed heading to h3 and an unprefixed one to h4, then
 * strips the prefix. A list with no prefixed line stays single-level and behaves exactly as it
 * did before, so existing sheet rows keep working untouched.
 *
 * Both stages must agree on this string; that is the whole reason it lives here rather than
 * being written twice into two Hebrew prompts, where a silent drift would leak "##" into a
 * clinical document. `stripGroupHeadingMarker` is the last-resort guard for that leak.
 */
export const GROUP_HEADING_MARKER = "##";

/** Removes a leading group-heading marker (and the space after it) from one heading's text.
 * Safe to call on any heading: text that carries no marker is returned unchanged. */
export function stripGroupHeadingMarker(text: string): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(GROUP_HEADING_MARKER)) return text;
  return trimmed.slice(GROUP_HEADING_MARKER.length).trimStart();
}

/** Whether a line from the rewritten text is a group heading rather than a sub-heading. */
export function isGroupHeading(text: string): boolean {
  return text.trimStart().startsWith(GROUP_HEADING_MARKER);
}
