// nginx.conf 静态合同：location 匹配优先级是本仓库事故多发区——
// 正则 location 会压过普通前缀 location，历史上咬过两次：
//   1. favicon/logo/watermark 正则里 try_files $uri 拼出 /app/static/static/ 双重路径
//   2. 根级缓存正则劫持 X-Accel-Redirect 内部 URI /_protected_static/...，
//      加速下载（分享 glb 预览、工单/询价图片附件）全变裸 404（v5.4.6 回归）
// 本脚本锁住已知坑位不变量，改动 nginx.conf 时 CI 先红再说。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const conf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'nginx.conf'), 'utf8');
const failures = [];
const check = (ok, msg) => {
  if (!ok) failures.push(msg);
};

// 按「location [修饰符] <path> {」行定位块，取到 4 空格缩进的闭括号为止
function locationBlock(path) {
  const esc = path.replaceAll('/', '\\/');
  const head = conf.match(new RegExp(`^ *location( [^\\s{/][^\\s]*)? ${esc} \\{`, 'm'));
  if (!head || head.index == null) return null;
  const end = conf.indexOf('\n    }', head.index);
  return end < 0 ? null : conf.slice(head.index, end);
}

// ── X-Accel 内部 location：^~ + internal 一个都不能少 ──────────────────
// ^~ 让最长前缀命中后跳过正则检查，防止任何后加的正则 location 劫持内部
// 重定向；internal 保证外部直访 404。去掉任一个都会把加速下载打穿。
for (const dir of ['/_protected_static/', '/_protected_uploads/']) {
  const block = locationBlock(dir);
  check(block != null, `缺少 location ${dir} 块`);
  if (block) {
    check(block.split('\n')[0].includes('^~'), `location ${dir} 必须带 ^~（正则 location 会劫持 X-Accel 内部重定向）`);
    check(block.includes('internal;'), `location ${dir} 必须保留 internal（禁止外部直访）`);
  }
}

// ── 根级固定名缓存正则：排除清单必须含 _protected_ ──────────────────
const rootRegex = conf.match(/location ~\* \^\/\(\?!([^)]+)\)/);
check(rootRegex != null, '缺少根级缓存正则 location（发版后固定名文件被钉旧版的修复）');
if (rootRegex) {
  const excludes = rootRegex[1].split('|').map((alt) => alt.trim());
  check(
    excludes.includes('_protected_'),
    `根级缓存正则的负向前瞻必须排除 _protected_（否则劫持 X-Accel 内部 URI，当前排除清单：${rootRegex[1]}）`,
  );
  // 排除清单同时必须保住 assets/static/api/uploads（各自有既定缓存策略）
  for (const keep of ['assets/', 'static/', 'api/', 'uploads/']) {
    check(excludes.includes(keep), `根级缓存正则的排除清单丢了 ${keep}`);
  }
}

// ── 既有缓存策略不回退 ──────────────────────────────────────────────
check(/location = \/version\.json \{[\s\S]*?no-store/.test(conf), 'version.json 必须 no-store（静默自动更新依赖它实时）');
check(/location = \/sw\.js \{[\s\S]*?no-store/.test(conf), 'sw.js 必须 no-store');
check(/location = \/index\.html \{[\s\S]*?no-cache, no-store/.test(conf), 'index.html 必须 no-cache');
check(/location \/assets\/ \{[\s\S]*?immutable/.test(conf), '/assets/ 哈希产物必须 immutable');
check(
  /location ~\* \^\/static\/\(favicon\|logo\|watermark\)\/\(\.\+\)\$ \{[\s\S]*?alias \/app\/static\/;[\s\S]*?try_files \/\$1\/\$2/.test(conf),
  'favicon/logo/watermark 正则必须用捕获组映射 alias（防 /app/static/static/ 双重路径）',
);

if (failures.length > 0) {
  console.error(`nginx.conf 合同检查失败（${failures.length} 项）：`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('nginx.conf 合同检查通过');
