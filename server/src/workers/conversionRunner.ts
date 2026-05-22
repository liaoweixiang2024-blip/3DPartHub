import { join } from 'node:path';
import { config } from '../lib/config.js';
import { convertStepToGltf, type GltfAsset } from '../services/converter.js';
import { generateThumbnail } from '../services/thumbnail.js';

type ConversionPayload = {
  modelId: string;
  filePath: string;
  originalName: string;
  ext: string;
  modelDir?: string;
  gltfUrlBase?: string;
  thumbnailDir?: string;
  skipThumbnail?: boolean;
};

type ThumbnailResult = {
  thumbnailPath: string;
  thumbnailUrl: string;
  thumbnailSmallUrl?: string;
};

function send(message: Record<string, unknown>) {
  if (process.send) {
    process.send(message);
  }
}

async function run(payload: ConversionPayload) {
  const modelDir = payload.modelDir || join(config.staticDir, 'models');
  const thumbDir = payload.thumbnailDir || join(config.staticDir, 'thumbnails');
  const gltfOptions = payload.gltfUrlBase ? { urlBase: payload.gltfUrlBase } : undefined;

  send({ type: 'log', message: '隔离转换子进程已启动' });
  send({ type: 'progress', progress: 30 });

  let result: GltfAsset;
  send({ type: 'log', message: '调用 STEP/IGES 转换器' });
  result = await convertStepToGltf(payload.filePath, modelDir, payload.modelId, payload.originalName, gltfOptions);

  send({ type: 'log', message: `转换完成: ${result.gltfUrl} (${result.gltfSize} bytes)` });
  send({ type: 'progress', progress: 70 });
  if (payload.skipThumbnail) {
    send({ type: 'result', result, thumbnail: null });
    return;
  }
  send({ type: 'log', message: '开始生成缩略图' });
  const thumbnail: ThumbnailResult = generateThumbnail(result.gltfPath, thumbDir, payload.modelId);
  send({ type: 'log', message: `缩略图生成完成: ${thumbnail.thumbnailUrl}` });
  send({ type: 'progress', progress: 90 });
  send({ type: 'result', result, thumbnail });
}

process.on('message', (message: unknown) => {
  const payload = (message as { payload?: ConversionPayload })?.payload;
  if (!payload) return;

  run(payload)
    .then(() => process.exit(0))
    .catch((err) => {
      const message = err instanceof Error ? err.message : '转换失败';
      const stack = err instanceof Error ? err.stack : undefined;
      send({ type: 'error', message, stack });
      process.exit(1);
    });
});
