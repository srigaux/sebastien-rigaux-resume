import { parseDocument, DomUtils } from "htmlparser2";

export { parseDocument as parseHtml };
export const htmlText = DomUtils.textContent;

// Parse attributes structurally: HTML minifiers may change order and quoting.
export function htmlElements(root, tagName) {
  return DomUtils.findAll((node) => tagName === "*" || node.name === tagName, root?.children ?? []);
}

export function jsonLdGraph(root) {
  return htmlElements(root, "script")
    .filter((node) => node.attribs.type === "application/ld+json")
    .flatMap((node) => JSON.parse(htmlText(node))["@graph"] ?? []);
}
