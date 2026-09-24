/**
 * Post-build: strip developer comments from static files that ship verbatim
 * (public/ is copied to dist/ untouched — no Vite transform, no minifier).
 *
 * - dist/sw.js: full-line `//` comments (line-anchored only — strings containing
 *   `//` mid-line are never touched). The design notes live on in public/sw.js.
 * - dist/maintenance.html: full-line `//` comments inside inline <script> blocks.
 *
 * Sources keep their comments; only the emitted artifacts are cleaned.
 * dist/index.html is already handled at build time by stripIndexHtmlCommentsPlugin
 * in vite.config.ts (transformIndexHtml does not apply to public/ files).
 */

import { readFileSync, writeFileSync } from 'node:fs';

const LINE_COMMENT = /^[ \t]*\/\/[^\n]*$\n?/gm;

function stripJsComments(code) {
  return code.replace(LINE_COMMENT, '');
}

function stripInlineScriptComments(html) {
  return html.replace(
    /(<script(?![^>]*\bsrc\b)[^>]*>)([\s\S]*?)(<\/script>)/g,
    (_m, open, body, close) => `${open}${stripJsComments(body)}${close}`,
  );
}

for (const file of ['dist/sw.js', 'dist/maintenance.html']) {
  const source = readFileSync(file, 'utf8');
  const cleaned = file.endsWith('.html') ? stripInlineScriptComments(source) : stripJsComments(source);
  if (cleaned !== source) {
    writeFileSync(file, cleaned);
    console.log(`stripped comments: ${file}`);
  }
}
