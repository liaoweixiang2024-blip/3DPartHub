import { closeSync, openSync, readSync } from "node:fs";

// Parse STEP/IGES file header for the original creation timestamp.
export function parseStepFileDate(filePath: string): Date | null {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(2000);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const head = buffer.toString("utf-8", 0, bytesRead);

    // STEP: FILE_NAME('name', '2026-03-19T09:10:22', ...)
    const match = head.match(/FILE_NAME\s*\([^;]*?'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})'/);
    if (match) return new Date(match[1]);

    // IGES: may have date in S06 or similar fields.
    const igMatch = head.match(/(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})(\d{2})/);
    if (igMatch) {
      return new Date(`${igMatch[1]}-${igMatch[2]}-${igMatch[3]}T${igMatch[4]}:${igMatch[5]}:${igMatch[6]}`);
    }
  } catch {
    // Keep upload/detail flows resilient when the CAD header is malformed.
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close errors; parsing is best-effort metadata enrichment.
      }
    }
  }
  return null;
}
