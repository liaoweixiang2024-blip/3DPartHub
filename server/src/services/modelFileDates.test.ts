import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseStepFileDate } from "./modelFileDates.js";

const root = mkdtempSync(join(tmpdir(), "model-file-dates-test-"));
const localTimestamp = "2026-03-19T09:10:22";
const expectedIso = new Date(localTimestamp).toISOString();

test.after(() => {
  rmSync(root, { recursive: true, force: true });
});

test("parses STEP FILE_NAME timestamp", () => {
  const filePath = join(root, "part.step");
  writeFileSync(filePath, `ISO-10303-21;HEADER;FILE_NAME('part.step','${localTimestamp}',(''),(''),'', '', '');ENDSEC;`);

  assert.equal(parseStepFileDate(filePath)?.toISOString(), expectedIso);
});

test("parses compact IGES-like timestamp", () => {
  const filePath = join(root, "part.igs");
  writeFileSync(filePath, "S      1\nGenerated at 20260319.091022");

  assert.equal(parseStepFileDate(filePath)?.toISOString(), expectedIso);
});

test("returns null for missing or malformed files", () => {
  const malformed = join(root, "bad.step");
  writeFileSync(malformed, "no useful date");

  assert.equal(parseStepFileDate(malformed), null);
  assert.equal(parseStepFileDate(join(root, "missing.step")), null);
});
