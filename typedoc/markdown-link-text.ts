const readMarkdownLink = (
  value: string,
  openBracket: number,
): { label: string; nextOffset: number } | undefined => {
  const closeBracket = value.indexOf("](", openBracket + 1);
  if (closeBracket === -1) return undefined;
  const closeParenthesis = value.indexOf(")", closeBracket + 2);
  if (closeParenthesis === -1) return undefined;
  return {
    label: value.slice(openBracket + 1, closeBracket),
    nextOffset: closeParenthesis + 1,
  };
};

const stripMarkdownLinks = (value: string): string => {
  let output = "";
  let offset = 0;
  while (offset < value.length) {
    const openBracket = value.indexOf("[", offset);
    if (openBracket === -1) {
      output += value.slice(offset);
      break;
    }
    output += value.slice(offset, openBracket);
    const link = readMarkdownLink(value, openBracket);
    if (!link) {
      output += value.slice(openBracket);
      break;
    }
    output += link.label;
    offset = link.nextOffset;
  }
  return output;
};

export const stripHeadingMarkup = (heading: string): string => {
  const withoutLinks = stripMarkdownLinks(heading);
  let output = "";
  let insideTag = false;

  for (const character of withoutLinks) {
    if (character === "<") {
      insideTag = true;
      continue;
    }
    if (character === ">" && insideTag) {
      insideTag = false;
      continue;
    }
    if (insideTag || "`*_~".includes(character)) {
      continue;
    }
    output += character;
  }

  return output;
};
