import type { Application } from "typedoc";
import {
  type MarkdownApplication,
  MarkdownPageEvent,
} from "typedoc-plugin-markdown";

export function removeLeadingReturnUnionPipe(app: Application): void {
  const markdownApp = app as MarkdownApplication;

  markdownApp.renderer.on(MarkdownPageEvent.END, (page) => {
    page.contents = page.contents.replace(
      /(^#{1,6} Returns\s*\n+\s*)\\\|\s+/gm,
      "$1",
    );
  });
}
