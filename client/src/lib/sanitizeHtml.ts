const FORBIDDEN_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
]);

const ALLOWED_TAGS = new Set([
  "a",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "col",
  "colgroup",
  "div",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "circle",
  "defs",
  "ellipse",
  "g",
  "line",
  "lineargradient",
  "path",
  "polygon",
  "polyline",
  "rect",
  "stop",
  "svg",
  "text",
]);

const GLOBAL_ATTRS = new Set([
  "align",
  "alt",
  "aria-hidden",
  "aria-label",
  "class",
  "colspan",
  "height",
  "role",
  "rowspan",
  "title",
  "width",
]);

const URL_ATTRS = new Set(["href", "src", "xlink:href"]);
const SVG_ATTRS = new Set([
  "cx",
  "cy",
  "d",
  "fill",
  "fill-opacity",
  "font-size",
  "gradienttransform",
  "gradientunits",
  "offset",
  "opacity",
  "points",
  "r",
  "rx",
  "ry",
  "stroke",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
  "transform",
  "viewbox",
  "x",
  "x1",
  "x2",
  "xmlns",
  "y",
  "y1",
  "y2",
]);

const TABLE_ATTRS = new Set(["cellpadding", "cellspacing"]);
const UNSAFE_CSS = /(?:expression\s*\(|url\s*\(|javascript:|vbscript:|@import|behavior\s*:|-moz-binding)/i;

function isAllowedAttribute(tag: string, name: string): boolean {
  if (GLOBAL_ATTRS.has(name) || SVG_ATTRS.has(name) || TABLE_ATTRS.has(name)) return true;
  if (URL_ATTRS.has(name)) return tag === "a" || tag === "img" || tag === "image" || tag === "use";
  if (name === "target" || name === "rel") return tag === "a";
  if (name === "style") return true;
  return false;
}

function sanitizeStyle(value: string): string {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      if (!part || UNSAFE_CSS.test(part)) return false;
      const separator = part.indexOf(":");
      if (separator <= 0) return false;
      const property = part.slice(0, separator).trim();
      return /^[a-zA-Z-]+$/.test(property);
    })
    .join("; ");
}

function isSafeUrl(value: string): boolean {
  const trimmed = Array.from(value.trim())
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127 && !/\s/.test(char);
    })
    .join("");
  if (!trimmed) return false;
  if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return true;
  }
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(trimmed)) return true;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function unwrapElement(element: Element) {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

function sanitizeNode(node: Node) {
  for (const child of Array.from(node.childNodes)) {
    sanitizeNode(child);
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    node.parentNode?.removeChild(node);
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (FORBIDDEN_TAGS.has(tag)) {
    element.remove();
    return;
  }

  if (!ALLOWED_TAGS.has(tag)) {
    unwrapElement(element);
    return;
  }

  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    if (name.startsWith("on") || name === "srcdoc" || !isAllowedAttribute(tag, name)) {
      element.removeAttribute(attr.name);
      continue;
    }

    if (URL_ATTRS.has(name) && !isSafeUrl(value)) {
      element.removeAttribute(attr.name);
      continue;
    }

    if (name === "style") {
      const safeStyle = sanitizeStyle(value);
      if (safeStyle) element.setAttribute(attr.name, safeStyle);
      else element.removeAttribute(attr.name);
    }
  }

  if (tag === "a" && element.getAttribute("target") === "_blank") {
    element.setAttribute("rel", "noopener noreferrer");
  }
}

export function sanitizeHtml(html: string): string {
  if (!html || typeof document === "undefined") return html || "";

  const template = document.createElement("template");
  template.innerHTML = html;
  sanitizeNode(template.content);
  return template.innerHTML;
}
