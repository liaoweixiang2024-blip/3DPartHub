import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Read a STEP/STP file, strip sensitive source metadata from the HEADER section,
 * and overwrite the file in-place. Returns true if any changes were made.
 *
 * What gets scrubbed:
 * - FILE_NAME: clears author, organization, preprocessor, originating_system, authorization
 * - The timestamp in FILE_NAME is preserved (it's not identifying info).
 *
 * OCCT (OpenCASCADE) only reads the DATA section for geometry, so clearing header
 * strings does not affect 3D model parsing.
 */
export function scrubStepMetadata(filePath: string): boolean {
  let content: string;
  try {
    const buf = readFileSync(filePath);
    content = buf.toString('utf-8');
  } catch {
    return false;
  }

  // Only process files that look like STEP
  if (!content.startsWith('ISO-10303') && !content.startsWith('HEAD')) {
    return false;
  }

  let modified = false;

  // Find FILE_NAME entity and scrub sensitive fields.
  // STEP FILE_NAME has 7 parameters:
  //   FILE_NAME('name','timestamp',('author'),('org'),'preproc','originating_system','auth');
  // We preserve param 1 (name, scrubbed) and param 2 (timestamp), clear params 3-7.
  const result = content.replace(
    // Matches both single-line and multi-line FILE_NAME across newlines
    /FILE_NAME\s*\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*\([^)]*\)\s*,\s*\([^)]*\)\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*\)\s*;/,
    (match) => {
      // Extract name (param 1) and timestamp (param 2)
      const paramRegex =
        /FILE_NAME\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*\(([^)]*)\)\s*,\s*\(([^)]*)\)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)\s*;/;
      const m = match.match(paramRegex);
      if (!m) return match;

      const name = m[1];
      const timestamp = m[2];
      const newName = scrubSensitiveStrings(name);
      const changed = newName !== name || m[3] !== '' || m[4] !== '' || m[5] !== '' || m[6] !== '' || m[7] !== '';
      if (!changed) return match;

      modified = true;
      return `FILE_NAME('${newName}','${timestamp}',(''),(''),'','','');`;
    },
  );

  if (result !== content) {
    modified = true;
    writeFileSync(filePath, result, 'utf-8');
  }

  return modified;
}

const SENSITIVE_PATTERNS = [
  /solid\s*works?/gi,
  /dassault/gi,
  /syst[eè]mes/gi,
  /autodesk/gi,
  /autocad/gi,
  /inventor/gi,
  /fusion\s*360/gi,
  /catia/gi,
  /siemens/gi,
  /creo/gi,
  /pro\s*engineer/gi,
  /solid\s*edge/gi,
  /freecad/gi,
  /onshape/gi,
  /rhino(?:ceros)?/gi,
  /spaceclaim/gi,
  /ironcad/gi,
  /varicad/gi,
  /bricscad/gi,
  /zwcad/gi,
  /tinkercad/gi,
  /alibre/gi,
  /moi3d/gi,
  /shapr3d/gi,
  /mastercam/gi,
  /powermill/gi,
  /hyperMill/gi,
  /nx\s*\d+/gi,
  /swstep/gi,
  /space\s*claim/gi,
];

function scrubSensitiveStrings(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '');
  }
  result = result.replace(/\s{2,}/g, ' ').trim();
  return result;
}

export function isStepFormat(ext: string): boolean {
  const lower = ext.toLowerCase();
  return lower === 'step' || lower === 'stp';
}
