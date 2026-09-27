import assert from 'node:assert/strict';
import test from 'node:test';
import { parseKitComponentLines } from './kitImport.js';

test('表头模式：附加列（编码等）进 specs，列序任意、列数不限', () => {
  const { items, badLines } = parseKitComponentLines(
    ['名称\t型号\t编码\t数量\t品牌', '弯头接头\tPC4-M5\tKAC-001\t2\tSMC', 'PC4-0.5\t\tKAC-002\t4\t'].join('\n'),
  );
  assert.deepEqual(badLines, []);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { name: '弯头接头', modelNo: 'PC4-M5', qty: 2, specs: { 编码: 'KAC-001', 品牌: 'SMC' } });
  // 型号列留空不挤占后续列位
  assert.deepEqual(items[1], { name: 'PC4-0.5', modelNo: '', qty: 4, specs: { 编码: 'KAC-002' } });
});

test('表头模式：名称列缺省时回落型号', () => {
  const { items } = parseKitComponentLines('型号\t编码\t数量\nPC4-0.5\tKAC-002\t4');
  assert.deepEqual(items, [{ name: 'PC4-0.5', modelNo: 'PC4-0.5', qty: 4, specs: { 编码: 'KAC-002' } }]);
});

test('表头模式：英文列名与列序调换（数量在前）', () => {
  const { items } = parseKitComponentLines('qty\tname\tmodel\n3\t接头\tJ-1');
  assert.deepEqual(items, [{ name: '接头', modelNo: 'J-1', qty: 3, specs: {} }]);
});

test('表头模式：数量非法的行记入 badLines 并跳过', () => {
  const { items, badLines } = parseKitComponentLines('名称\t型号\t数量\nA\tM1\t2\nB\tM2\tx');
  assert.deepEqual(badLines, [3]);
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 2);
});

test('无表头：旧三列/两列/单列行为完全兼容', () => {
  const { items, badLines } = parseKitComponentLines('弯头接头\tPC4-M5\t2\nPC4-0.5\t4\nPC6-1');
  assert.deepEqual(badLines, []);
  assert.deepEqual(items, [
    { name: '弯头接头', modelNo: 'PC4-M5', qty: 2, specs: {} },
    { name: 'PC4-0.5', modelNo: 'PC4-0.5', qty: 4, specs: {} },
    { name: 'PC6-1', modelNo: 'PC6-1', qty: 1, specs: {} },
  ]);
});

test('无表头：第 4 列起自动命名进 specs（无固定列数上限）', () => {
  const { items } = parseKitComponentLines('接头\tPC4-M5\t2\tKAC-009\t不锈钢');
  assert.deepEqual(items, [{ name: '接头', modelNo: 'PC4-M5', qty: 2, specs: { 列4: 'KAC-009', 列5: '不锈钢' } }]);
});

test('注释行（# 开头）与空行跳过，不参与行号', () => {
  const { items, badLines } = parseKitComponentLines('# 备注\n名称\t型号\t数量\n\nA\tM\t1');
  assert.deepEqual(badLines, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'A');
});

test('首行是数据（非表头）时不会被误判为表头', () => {
  const { items } = parseKitComponentLines('数量传感器\tQS-1\t2');
  assert.equal(items.length, 1);
  assert.equal(items[0].name, '数量传感器');
  assert.equal(items[0].qty, 2);
});
