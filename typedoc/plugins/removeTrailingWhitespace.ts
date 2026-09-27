import type { Application } from "typedoc";
import {
  type MarkdownApplication,
  MarkdownPageEvent,
} from "typedoc-plugin-markdown";

export function removeTrailingWhitespace(app: Application): void {
  const markdownApp = app as MarkdownApplication;

  markdownApp.renderer.on(MarkdownPageEvent.END, (page) => {
    page.contents = page.contents.replace(/[ \t]+$/gm, "");
  });
}
