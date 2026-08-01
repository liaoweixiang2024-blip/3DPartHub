import assert from 'node:assert/strict';
import test from 'node:test';

const { buildInviteUrl } = await import('./inviteUrl.js');

test('buildInviteUrl: 正常拼接', () => {
  assert.equal(buildInviteUrl('ABC123', 'https://example.com'), 'https://example.com/register?invite=ABC123');
});

test('buildInviteUrl: 去掉 origin 末尾斜杠', () => {
  assert.equal(buildInviteUrl('ABC', 'https://example.com/'), 'https://example.com/register?invite=ABC');
  assert.equal(buildInviteUrl('ABC', 'https://example.com///'), 'https://example.com/register?invite=ABC');
});

test('buildInviteUrl: code 做 URL 编码（含空格等特殊字符）', () => {
  assert.equal(buildInviteUrl('a b', 'https://x.io'), 'https://x.io/register?invite=a%20b');
  assert.equal(buildInviteUrl('a/b', 'https://x.io'), 'https://x.io/register?invite=a%2Fb');
});

test('buildInviteUrl: base64url 字符集（-_）保持原样', () => {
  assert.equal(buildInviteUrl('aB-3_f', 'https://x.io'), 'https://x.io/register?invite=aB-3_f');
});

test('buildInviteUrl: 空 origin 兜底为相对路径', () => {
  assert.equal(buildInviteUrl('ABC', ''), '/register?invite=ABC');
});
