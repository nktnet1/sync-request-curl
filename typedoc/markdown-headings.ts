import { stripHeadingMarkup } from "#typedoc/markdown-link-text";

export type { MarkdownHeading } from "#typedoc/markdown-parser";
export {
  parseMarkdownLines,
  shiftMarkdownHeadings,
} from "#typedoc/markdown-parser";

export const headingAnchor = (heading: string): string => {
  const plainHeading = stripHeadingMarkup(heading).toLowerCase();
  let anchor = "";
  let pendingSeparator = false;

  for (const character of plainHeading) {
    const isAsciiLetter = character >= "a" && character <= "z";
    const isDigit = character >= "0" && character <= "9";
    if (isAsciiLetter || isDigit) {
      if (pendingSeparator && anchor) {
        anchor += "-";
      }
      anchor += character;
      pendingSeparator = false;
    } else if (anchor) {
      pendingSeparator = true;
    }
  }

  if (!anchor) {
    throw new Error(`Could not generate an anchor for heading: ${heading}`);
  }

  return anchor;
};
