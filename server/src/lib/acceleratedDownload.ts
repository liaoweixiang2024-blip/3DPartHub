import type { Request, Response } from "express";
import { createReadStream } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { config } from "./config.js";

type Disposition = "attachment" | "inline";

function asciiFileName(fileName: string) {
  return fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
}

function contentDisposition(disposition: Disposition, fileName: string) {
  const safeName = asciiFileName(fileName);
  return `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function contentTypeForFile(fileName: string) {
  const ext = extname(fileName).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".zip") return "application/zip";
  return "application/octet-stream";
}

function accelPathFor(filePath: string): string | null {
  const absolutePath = resolve(filePath);
  const roots = [
    { root: resolve(process.cwd(), config.staticDir), prefix: "/_protected_static" },
    { root: resolve(process.cwd(), config.uploadDir), prefix: "/_protected_uploads" },
  ];

  for (const { root, prefix } of roots) {
    const rel = relative(root, absolutePath);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.includes("\0")) continue;
    const encoded = rel.split(sep).map(encodeURIComponent).join("/");
    return `${prefix}/${encoded}`;
  }

  return null;
}

export function sendAcceleratedFile(req: Request, res: Response, options: {
  filePath: string;
  fileName: string;
  contentType?: string;
  disposition?: Disposition;
  cacheControl?: string;
}) {
  const {
    filePath,
    fileName,
    contentType = contentTypeForFile(fileName),
    disposition = "attachment",
    cacheControl = "private, max-age=300",
  } = options;

  res.setHeader("Content-Disposition", contentDisposition(disposition, fileName));
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", cacheControl);

  const accelPath = req.headers["x-accel-available"] === "1" ? accelPathFor(filePath) : null;
  if (accelPath) {
    res.setHeader("X-Accel-Redirect", accelPath);
    res.status(200).end();
    return;
  }

  const absolutePath = resolve(filePath);
  const allowedRoots = [resolve(process.cwd(), config.staticDir), resolve(process.cwd(), config.uploadDir)];
  const isContained = allowedRoots.some((root) => absolutePath === root || absolutePath.startsWith(`${root}${sep}`));
  if (!isContained) {
    res.status(403).json({ detail: "文件访问被拒绝" });
    return;
  }

  createReadStream(filePath).pipe(res);
}
