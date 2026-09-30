import type { Application } from "typedoc";
import {
  type MarkdownApplication,
  MarkdownPageEvent,
} from "typedoc-plugin-markdown";
import { EXTERNAL_TYPE_LINKS } from "#typedoc/externalLinks";

const linkUnlinkedInlineCodeReference = (
  contents: string,
  typeName: keyof typeof EXTERNAL_TYPE_LINKS,
): string => {
  const inlineCodeReference = `\`${typeName}\``;
  const linkedReference = `[${inlineCodeReference}](${EXTERNAL_TYPE_LINKS[typeName]})`;
  const unlinkedReference = new RegExp(
    `(?<!\\[)${inlineCodeReference}(?!\\]\\()`,
    "g",
  );

  return contents.replace(unlinkedReference, linkedReference);
};

const linkExternalTypeReferences = (contents: string): string =>
  Object.keys(EXTERNAL_TYPE_LINKS).reduce(
    (linkedContents, typeName) =>
      linkUnlinkedInlineCodeReference(
        linkedContents,
        typeName as keyof typeof EXTERNAL_TYPE_LINKS,
      ),
    contents,
  );

/**
 * Keep external public types linked when markdown code-block rendering prevents
 * typedoc-plugin-markdown from preserving symbol links in unions and tables.
 */
export function linkExternalTypes(app: Application): void {
  const markdownApp = app as MarkdownApplication;

  markdownApp.renderer.on(MarkdownPageEvent.END, (page) => {
    page.contents = linkExternalTypeReferences(page.contents);
  });
}
