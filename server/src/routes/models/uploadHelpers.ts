import { rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { Response } from 'express';
import multer from 'multer';
import { getBusinessConfig } from '../../lib/businessConfig.js';
import { config } from '../../lib/config.js';

export const modelUpload = multer({
  dest: config.uploadDir,
  limits: { fileSize: config.maxFileSize },
});

export async function validateModelUpload(file: Express.Multer.File, res: Response): Promise<string | null> {
  const originalName = file.originalname || 'unknown.step';
  const ext = originalName.split('.').pop()?.toLowerCase() || '';
  const { uploadPolicy } = await getBusinessConfig();
  const formats = uploadPolicy.modelFormats.map((item) => item.toLowerCase());
  const maxBytes = Math.max(1, uploadPolicy.modelMaxSizeMb) * 1024 * 1024;
  if (!ext || !formats.includes(ext)) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: `不支持的格式，请上传 ${formats.map((item) => `.${item}`).join(' / ')} 文件` });
    return null;
  }
  if (file.size > maxBytes) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: `文件过大，最大支持 ${uploadPolicy.modelMaxSizeMb}MB` });
    return null;
  }
  return ext;
}

export function pathInside(candidate: string, root: string): boolean {
  const resolved = resolve(candidate);
  const resolvedRoot = resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${sep}`);
}
