import { rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { Response, type RequestHandler } from 'express';
import multer from 'multer';
import { getBusinessConfig } from '../../lib/businessConfig.js';
import { config } from '../../lib/config.js';
import { modelMaxBytes, modelMaxSizeMb, productImageMaxBytes, productImageMaxSizeMb } from '../../lib/uploadLimits.js';

export const modelUpload = {
  single(fieldName: string): RequestHandler {
    return (req, res, next) => {
      getBusinessConfig()
        .then(({ uploadPolicy }) => {
          const maxMb = modelMaxSizeMb(uploadPolicy);
          const upload = multer({
            dest: config.uploadDir,
            limits: { fileSize: modelMaxBytes(uploadPolicy) },
          }).single(fieldName);

          upload(req, res, (err) => {
            if (!err) {
              next();
              return;
            }

            const uploadError = err as { code?: string; message?: string };
            if (uploadError.code === 'LIMIT_FILE_SIZE') {
              res.status(400).json({ detail: `文件过大，最大支持 ${maxMb}MB` });
              return;
            }
            res.status(400).json({ detail: uploadError.message || '上传失败' });
          });
        })
        .catch(next);
    };
  },
};

export const modelImageUpload = {
  single(fieldName: string): RequestHandler {
    return (req, res, next) => {
      getBusinessConfig()
        .then(({ uploadPolicy }) => {
          const maxMb = productImageMaxSizeMb(uploadPolicy);
          const upload = multer({
            dest: config.uploadDir,
            limits: { fileSize: productImageMaxBytes(uploadPolicy) },
          }).single(fieldName);

          upload(req, res, (err) => {
            if (!err) {
              next();
              return;
            }

            const uploadError = err as { code?: string; message?: string };
            if (uploadError.code === 'LIMIT_FILE_SIZE') {
              res.status(400).json({ detail: `图片不能超过 ${maxMb}MB` });
              return;
            }
            res.status(400).json({ detail: uploadError.message || '图片上传失败' });
          });
        })
        .catch(next);
    };
  },
};

export async function validateModelUpload(file: Express.Multer.File, res: Response): Promise<string | null> {
  const originalName = file.originalname || 'unknown.step';
  const ext = originalName.split('.').pop()?.toLowerCase() || '';
  const { uploadPolicy } = await getBusinessConfig();
  const formats = uploadPolicy.modelFormats.map((item) => item.toLowerCase());
  const maxBytes = modelMaxBytes(uploadPolicy);
  const maxMb = modelMaxSizeMb(uploadPolicy);
  if (!ext || !formats.includes(ext)) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: `不支持的格式，请上传 ${formats.map((item) => `.${item}`).join(' / ')} 文件` });
    return null;
  }
  if (file.size <= 0) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: '文件内容为空，请重新选择有效的模型文件' });
    return null;
  }
  if (file.size > maxBytes) {
    rmSync(file.path, { force: true });
    res.status(400).json({ detail: `文件过大，最大支持 ${maxMb}MB` });
    return null;
  }
  return ext;
}

export function pathInside(candidate: string, root: string): boolean {
  const resolved = resolve(candidate);
  const resolvedRoot = resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${sep}`);
}
