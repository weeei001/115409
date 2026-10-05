import { DomUtils, parseDocument } from 'htmlparser2';

/** Inspect rendered elements rather than interpreting HTML with regular expressions. */
export function renderedElements(markup: string, tagName: string) {
  return DomUtils.getElementsByTagName(tagName, parseDocument(markup));
}

export function renderedText(markup: string | Parameters<typeof DomUtils.textContent>[0]) {
  return DomUtils.textContent(typeof markup === 'string' ? parseDocument(markup) : markup);
}
