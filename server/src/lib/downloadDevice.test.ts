import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceFromUserAgent } from './downloadDevice.js';

// 真实 UA 样本（iOS Safari / Android Chrome / 桌面 Chrome / 桌面 Safari / curl）
const SAMPLES: Array<[string, 'mobile' | 'desktop']> = [
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'mobile',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
    'mobile',
  ],
  [
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'mobile',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'desktop',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'desktop',
  ],
  ['curl/8.4.0', 'desktop'],
];

test('classifies real-world user agents into mobile/desktop', () => {
  for (const [ua, expected] of SAMPLES) {
    assert.equal(deviceFromUserAgent(ua), expected, ua.slice(0, 40));
  }
});

test('missing or empty user agent falls back to unknown', () => {
  assert.equal(deviceFromUserAgent(undefined), 'unknown');
  assert.equal(deviceFromUserAgent(null), 'unknown');
  assert.equal(deviceFromUserAgent(''), 'unknown');
  assert.equal(deviceFromUserAgent('   '), 'unknown');
});
