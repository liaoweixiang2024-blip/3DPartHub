import { join } from 'node:path';
import { config } from '../lib/config.js';
import { convertStepToGltf, reconvertModelWithGmsh, type GltfAsset } from '../services/converter.js';
import { generateThumbnail, type ThumbnailResult } from '../services/thumbnail.js';

/**
 * 手动重转隔离子进程（编辑弹窗「标准转换/修复转换」）。
 *
 * 进程模型：API 进程 fork 本模块，通过 IPC 消息驱动。重活（occt WASM 解析、
 * gmsh 子进程、软件光栅化缩略图）都在本子进程内执行——API 进程事件循环
 * 不受影响，转换期间网站正常服务。
 *
 * 消息协议（父 → 子）：{ type: 'run', payload }
 * 消息协议（子 → 父）：{ type: 'progress', progress, message }
 *                    | { type: 'done', result, thumbnail }
 *                    | { type: 'error', message }
 */

type RunPayload = {
  engine: 'standard' | 'gmsh';
  inputPath: string;
  modelId: string;
  originalName: string;
};

function send(message: Record<string, unknown>) {
  if (process.send) {
    process.send(message);
  }
}

async function run(payload: RunPayload) {
  const modelDir = join(config.staticDir, 'models');
  const thumbDir = join(config.staticDir, 'thumbnails');
  const onProgress = (percent: number, message: string) => {
    send({ type: 'progress', progress: percent, message });
  };

  send({ type: 'progress', progress: 5, message: '已启动转换子进程...' });

  let result: GltfAsset;
  if (payload.engine === 'gmsh') {
    result = await reconvertModelWithGmsh(payload.inputPath, modelDir, payload.modelId, payload.originalName, {
      onProgress,
    });
  } else {
    result = await convertStepToGltf(payload.inputPath, modelDir, payload.modelId, payload.originalName, {
      onProgress,
    });
  }

  send({ type: 'progress', progress: 90, message: '正在生成预览图...' });
  const thumbnail: ThumbnailResult = generateThumbnail(result.gltfPath, thumbDir, payload.modelId);
  send({ type: 'done', result, thumbnail });
}

process.on('message', (message: { type: string; payload?: RunPayload }) => {
  if (message?.type !== 'run' || !message.payload) {
    send({ type: 'error', message: '无效的任务消息' });
    return;
  }
  run(message.payload).catch((err) => {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  });
});
