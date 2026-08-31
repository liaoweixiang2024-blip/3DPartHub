import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ||= 'test-secret';

const { sendAcceleratedFile } = await import('./acceleratedDownload.js');

class MockResponse extends Writable {
  statusCode = 200;
  headers = new Map<string, string>();
  chunks: Buffer[] = [];

  setHeader(name: string, value: string | number) {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  getHeader(name: string) {
    return this.headers.get(name.toLowerCase());
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(payload: unknown) {
    this.setHeader('Content-Type', 'application/json');
    this.end(JSON.stringify(payload));
    return this;
  }

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }

  bodyText() {
    return Buffer.concat(this.chunks).toString('utf-8');
  }
}

function createMockRequest(method = 'GET', headers: Record<string, string> = {}) {
  return {
    method,
    headers,
  };
}

function createTestFile(content: string) {
  const uploadRoot = resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
  mkdirSync(uploadRoot, { recursive: true });
  const dir = mkdtempSync(join(uploadRoot, 'accelerated-download-test-'));
  const filePath = join(dir, 'sample.step');
  writeFileSync(filePath, content);
  return {
    filePath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function sendTestDownload(
  filePath: string,
  method = 'GET',
  headers: Record<string, string> = {},
  options: { forceStream?: boolean } = {},
) {
  const res = new MockResponse();
  sendAcceleratedFile(createMockRequest(method, headers) as never, res as never, {
    filePath,
    fileName: 'sample.step',
    contentType: 'application/octet-stream',
    disposition: 'attachment',
    ...(options.forceStream ? { forceStream: true } : {}),
  });
  await once(res, 'finish');
  return res;
}

test('download responses expose content length for browser download managers', async () => {
  const fixture = createTestFile('0123456789');
  try {
    const response = await sendTestDownload(fixture.filePath, 'HEAD');

    assert.equal(response.statusCode, 200);
    assert.equal(response.getHeader('content-length'), '10');
    assert.equal(response.getHeader('accept-ranges'), 'bytes');
    assert.equal(response.bodyText(), '');
  } finally {
    fixture.cleanup();
  }
});

test('download responses support byte ranges', async () => {
  const fixture = createTestFile('0123456789');
  try {
    const response = await sendTestDownload(fixture.filePath, 'GET', { range: 'bytes=2-5' });

    assert.equal(response.statusCode, 206);
    assert.equal(response.getHeader('content-range'), 'bytes 2-5/10');
    assert.equal(response.getHeader('content-length'), '4');
    assert.equal(response.bodyText(), '2345');
  } finally {
    fixture.cleanup();
  }
});

test('accel header still drives X-Accel-Redirect by default (other callers unchanged)', async () => {
  const fixture = createTestFile('0123456789');
  try {
    const response = await sendTestDownload(fixture.filePath, 'GET', { 'x-accel-available': '1' });

    assert.equal(response.statusCode, 200);
    assert.ok(response.getHeader('x-accel-redirect'));
    assert.ok(String(response.getHeader('x-accel-redirect')).startsWith('/_protected_uploads/'));
    // 加速路径不回正文（nginx 负责发文件）
    assert.equal(response.bodyText(), '');
  } finally {
    fixture.cleanup();
  }
});

test('forceStream ignores accel header and streams file bytes directly', async () => {
  const fixture = createTestFile('0123456789');
  try {
    const response = await sendTestDownload(
      fixture.filePath,
      'GET',
      { 'x-accel-available': '1' },
      { forceStream: true },
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.getHeader('x-accel-redirect'), undefined);
    assert.equal(response.getHeader('content-length'), '10');
    assert.equal(response.bodyText(), '0123456789');
  } finally {
    fixture.cleanup();
  }
});

test('forceStream keeps range support on the direct stream path', async () => {
  const fixture = createTestFile('0123456789');
  try {
    const response = await sendTestDownload(
      fixture.filePath,
      'GET',
      { 'x-accel-available': '1', range: 'bytes=2-5' },
      { forceStream: true },
    );

    assert.equal(response.statusCode, 206);
    assert.equal(response.getHeader('x-accel-redirect'), undefined);
    assert.equal(response.getHeader('content-range'), 'bytes 2-5/10');
    assert.equal(response.bodyText(), '2345');
  } finally {
    fixture.cleanup();
  }
});
