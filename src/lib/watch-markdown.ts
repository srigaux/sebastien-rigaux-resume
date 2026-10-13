import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: false });
markdown.disable(["image", "autolink"]);
markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index].attrSet("rel", "noopener noreferrer");
  tokens[index].attrSet("target", "_blank");
  return self.renderToken(tokens, index, options);
};

export function renderSummaryMarkdown(summary: string): string {
  return markdown.renderInline(summary.trim());
}
