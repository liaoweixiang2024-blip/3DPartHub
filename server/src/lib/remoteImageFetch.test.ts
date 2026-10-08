import assert from 'node:assert/strict';
import test from 'node:test';

const { isBlockedRemoteAddress } = await import('./remoteImageFetch.js');

// SSRF 黑名单回归：IPv4 全保留段 + IPv6 完整展开匹配（含历史上漏掉的
// IPv4 兼容/映射十六进制形态、NAT64、6to4）
test('isBlockedRemoteAddress blocks IPv4 private/reserved ranges', () => {
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254', // 云元数据端点
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1', // CGNAT
    '224.0.0.1', // 多播
    '255.255.255.255',
  ];
  for (const addr of blocked) assert.equal(isBlockedRemoteAddress(addr), true, addr);

  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34'];
  for (const addr of allowed) assert.equal(isBlockedRemoteAddress(addr), false, addr);
});

test('isBlockedRemoteAddress blocks IPv6 loopback/mapped/compat/link-local/ULA/multicast/NAT64/6to4', () => {
  const blocked = [
    '::',
    '::1',
    '::127.0.0.1', // IPv4 兼容格式环回（旧实现漏掉）
    '::7f00:1', // 同上的十六进制写法（旧实现漏掉）
    '::ffff:127.0.0.1', // IPv4 映射环回
    '::ffff:7f00:1', // 映射的十六进制写法（旧实现漏掉）
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    'fe80::1', // 链路本地
    'fc00::1', // ULA
    'fd12:3456:789a::1',
    'ff02::1', // 多播
    '64:ff9b::7f00:1', // NAT64 映射 127.0.0.1
    '64:ff9b::a00:1', // NAT64 映射 10.0.0.1
    '2002:7f00:1::1', // 6to4 内嵌 127.0.0.1
    '2002:0a00:1::1', // 6to4 内嵌 10.0.0.1
  ];
  for (const addr of blocked) assert.equal(isBlockedRemoteAddress(addr), true, addr);

  const allowed = ['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:81b::200e'];
  for (const addr of allowed) assert.equal(isBlockedRemoteAddress(addr), false, addr);
});
