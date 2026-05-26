import assert from 'node:assert/strict';
import test from 'node:test';

const { buildFooterCopyright, buildModelDetailCopyright, normalizeFooterLinksSetting, validateSettingValue } =
  await import('./settings.js');

test('buildFooterCopyright uses current year and provided title', () => {
  const result = buildFooterCopyright('MyApp');
  assert.ok(result.includes(String(new Date().getFullYear())));
  assert.ok(result.includes('MyApp'));
  assert.ok(result.includes('All rights reserved.'));
});

test('buildFooterCopyright falls back to 3DPartHub for empty input', () => {
  const result = buildFooterCopyright('');
  assert.ok(result.includes('3DPartHub'));
  assert.ok(buildFooterCopyright(undefined).includes('3DPartHub'));
  assert.ok(buildFooterCopyright(null).includes('3DPartHub'));
});

test('buildModelDetailCopyright does not include All rights reserved', () => {
  const result = buildModelDetailCopyright('TestApp');
  assert.ok(result.includes('TestApp'));
  assert.ok(!result.includes('All rights reserved'));
});

test('normalizeFooterLinksSetting returns empty array for bad input', () => {
  assert.equal(normalizeFooterLinksSetting(''), '[]');
  assert.equal(normalizeFooterLinksSetting(null), '[]');
  assert.equal(normalizeFooterLinksSetting(undefined), '[]');
  assert.equal(normalizeFooterLinksSetting('not json'), '[]');
  assert.equal(normalizeFooterLinksSetting(42), '[]');
});

test('normalizeFooterLinksSetting parses and filters valid links', () => {
  const result = normalizeFooterLinksSetting([
    { label: 'GitHub', url: 'https://github.com' },
    { label: '', url: 'https://example.com' },
    { label: 'No URL', url: '' },
    { label: 'Valid', url: 'https://valid.com' },
  ]);
  const parsed = JSON.parse(result);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].label, 'GitHub');
  assert.equal(parsed[1].label, 'Valid');
});

test('normalizeFooterLinksSetting accepts JSON string input', () => {
  const result = normalizeFooterLinksSetting('[{"label":"Docs","url":"/docs"}]');
  const parsed = JSON.parse(result);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].label, 'Docs');
});

test('normalizeFooterLinksSetting trims whitespace from labels and urls', () => {
  const result = normalizeFooterLinksSetting([{ label: '  Trimmed  ', url: '  https://a.com  ' }]);
  const parsed = JSON.parse(result);
  assert.equal(parsed[0].label, 'Trimmed');
  assert.equal(parsed[0].url, 'https://a.com');
});

test('validateSettingValue clamps numeric settings', () => {
  assert.equal(validateSettingValue('smtp_port', 465), 465);
  assert.equal(validateSettingValue('smtp_port', 'bad'), 465);
  assert.equal(validateSettingValue('security_password_min_length', 12), 12);
});

test('validateSettingValue handles boolean settings', () => {
  assert.equal(validateSettingValue('require_login_download', true), true);
  assert.equal(validateSettingValue('require_login_download', 0), false);
  assert.equal(validateSettingValue('allow_register', 'yes'), true);
});

test('validateSettingValue validates cache_driver enum', () => {
  assert.equal(validateSettingValue('cache_driver', 'redis'), 'redis');
  assert.equal(validateSettingValue('cache_driver', 'memory'), 'memory');
  assert.equal(validateSettingValue('cache_driver', 'off'), 'off');
  assert.equal(validateSettingValue('cache_driver', 'invalid'), 'redis');
});

test('validateSettingValue validates storage_provider enum', () => {
  assert.equal(validateSettingValue('storage_provider', 'local'), 'local');
  assert.equal(validateSettingValue('storage_provider', 'minio'), 'minio');
  assert.equal(validateSettingValue('storage_provider', 'bogus'), 'local');
});

test('validateSettingValue validates color_scheme', () => {
  assert.equal(validateSettingValue('color_scheme', 'orange'), 'orange');
  assert.equal(validateSettingValue('color_scheme', 'blue'), 'blue');
  assert.equal(validateSettingValue('color_scheme', 'custom'), 'custom');
  assert.equal(validateSettingValue('color_scheme', 'neon'), 'orange');
});

test('validateSettingValue normalizes color_custom_dark JSON', () => {
  const result = validateSettingValue('color_custom_dark', '{"primary":"#ff0000"}');
  assert.equal(typeof result, 'string');
  const parsed = JSON.parse(result as string);
  assert.equal(parsed.primary, '#ff0000');
});

test('validateSettingValue rejects oversized color JSON', () => {
  const huge = JSON.stringify({ data: 'x'.repeat(20_001) });
  const result = validateSettingValue('color_custom_dark', huge);
  assert.equal(result, '{}');
});

test('validateSettingValue clamps cache TTL seconds', () => {
  assert.equal(validateSettingValue('cache_public_settings_ttl_seconds', 120), 120);
  assert.equal(validateSettingValue('cache_public_settings_ttl_seconds', 100000), 86400);
  assert.equal(validateSettingValue('cache_public_settings_ttl_seconds', -1), 0);
});

test('validateSettingValue clamps storage prefix settings', () => {
  assert.equal(validateSettingValue('storage_model_prefix', '  /models/  '), 'models');
  assert.equal(validateSettingValue('storage_model_prefix', '//double//'), 'double');
  assert.equal(validateSettingValue('storage_model_prefix', ''), 'models');
});

test('validateSettingValue passes through unknown keys', () => {
  assert.equal(validateSettingValue('site_title', 'My Title'), 'My Title');
});

test('validateSettingValue truncates strings over 1MB', () => {
  const long = 'x'.repeat(1_000_001);
  const result = validateSettingValue('site_title', long) as string;
  assert.equal(result.length, 1_000_000);
});
