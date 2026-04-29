#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

const gitList = (args) =>
  execFileSync("git", args, { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, "/"));

const tracked = gitList(["ls-files", "-z"]);
const untracked = gitList(["ls-files", "--others", "--exclude-standard", "-z"]);
const files = [...new Set([...tracked, ...untracked])];

const sensitiveExtensions = new Set([
  ".bak",
  ".backup",
  ".db",
  ".dump",
  ".sqlite",
  ".sqlite3",
  ".7z",
  ".rar",
  ".zip",
  ".tar",
  ".tgz",
  ".gz",
  ".stp",
  ".step",
  ".iges",
  ".igs",
  ".stl",
  ".obj",
  ".fbx",
  ".glb",
  ".gltf",
  ".x_t",
  ".xt",
  ".sldprt",
  ".sldasm",
  ".dwg",
  ".dxf",
  ".xls",
  ".xlsx",
  ".pdf",
]);

const sensitivePathPatterns = [
  /^\.env($|\.)/,
  /(^|\/)\.env($|\.)/,
  /(^|\/)private-docs\//,
  /^data\//,
  /(^|\/)\.tmp\//,
  /(^|\/)backups?\//,
  /^client\/public\/data\//,
  /^client\/public\/product-wall-assets\//,
  /^server\/uploads\//,
  /^server\/static\/(models|originals|thumbnails|batch|backups|_backup_db|_safety_snapshots|drawings|option-images|ticket-attachments|html-previews|logo|favicon|selection-categories-ai|watermark)\//,
];

const contentPatterns = [
  { name: "GitHub token", regex: /\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]{20,})\b/g },
  { name: "OpenAI-style API key", regex: /\bsk-[A-Za-z0-9_-]{32,}\b/g },
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Private key", regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |)PRIVATE KEY-----/g },
  {
    name: "Hard-coded secret env value",
    regex: /\b(?:JWT_SECRET|ADMIN_PASS|DB_PASSWORD|DATABASE_URL|SMTP_PASS|MINIO_SECRET_KEY)\s*=\s*["']?([^"'\s]+)/gi,
    allowValue: (value) =>
      /\$\{|^\$\(|change-me|example|placeholder|test-secret|test:test|local-dev|modelpass|password|set_|你的|密码@|process\.env|config\.|dbUrl/i.test(value),
  },
];

const allowedPath = (file) =>
  file.endsWith(".env.example") ||
  file === ".env.example" ||
  file === "client/.env.example" ||
  file.includes("/migrations/") ||
  file === "client/public/favicon.svg" ||
  file === "client/public/icons.svg";

const findings = [];

for (const file of files) {
  if (allowedPath(file)) continue;
  const ext = path.extname(file).toLowerCase();
  if (sensitiveExtensions.has(ext)) {
    findings.push({ file, kind: "sensitive file extension" });
  }
  if (sensitivePathPatterns.some((pattern) => pattern.test(file))) {
    findings.push({ file, kind: "sensitive path" });
  }
}

const textExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".sh",
  ".html",
  ".css",
  ".example",
]);

for (const file of files) {
  if (allowedPath(file)) continue;
  const ext = path.extname(file).toLowerCase();
  if (ext && !textExtensions.has(ext)) continue;
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) continue;
  const statText = readFileSync(fullPath);
  if (statText.length > 2 * 1024 * 1024) continue;
  const text = statText.toString("utf8");
  const lines = text.split(/\r?\n/);
  for (const { name, regex, allowValue } of contentPatterns) {
    regex.lastIndex = 0;
    for (const line of lines) {
      let match;
      while ((match = regex.exec(line))) {
        const value = match[1] || match[0];
        if (allowValue?.(value)) continue;
        const lineNumber = lines.indexOf(line) + 1;
        findings.push({ file, line: lineNumber, kind: name });
      }
    }
  }
}

if (findings.length) {
  console.error("Privacy audit failed. Review these paths before publishing:");
  for (const finding of findings) {
    console.error(`- ${finding.file}${finding.line ? `:${finding.line}` : ""} (${finding.kind})`);
  }
  process.exit(1);
}

console.log("Privacy audit passed: no tracked/unignored sensitive files or obvious secrets found.");
