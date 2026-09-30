import type { Application } from "typedoc";
import {
  type MarkdownApplication,
  MarkdownPageEvent,
} from "typedoc-plugin-markdown";
import { MDN_URL_REFERENCE } from "#typedoc/externalLinks";

const REQUEST_URL_ROW_PREFIX = "| `url` |";
const URL_TYPE_REFERENCE = "`URL`";
const LINKED_URL_TYPE_REFERENCE = `[${URL_TYPE_REFERENCE}](${MDN_URL_REFERENCE})`;

const linkRequestUrlTypeReference = (contents: string): string =>
  contents
    .split("\n")
    .map((line) =>
      line.startsWith(REQUEST_URL_ROW_PREFIX)
        ? line.replace(URL_TYPE_REFERENCE, LINKED_URL_TYPE_REFERENCE)
        : line,
    )
    .join("\n");

/**
 * Keep the request URL parameter linked to MDN when markdown code-block
 * rendering prevents typedoc-plugin-markdown from linking the URL member of
 * the `string | URL` union automatically.
 */
export function linkRequestUrlType(app: Application): void {
  const markdownApp = app as MarkdownApplication;

  markdownApp.renderer.on(MarkdownPageEvent.END, (page) => {
    page.contents = linkRequestUrlTypeReference(page.contents);
  });
}
