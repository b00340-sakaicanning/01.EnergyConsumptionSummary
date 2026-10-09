/**
 * tests/verify_config_sync.js
 * GAS側 (gas_app/Config.gs) とブラウザ側 (gas_app/js/config.js) に二重定義されている
 * マスター設定がずれていないことを検証するテスト
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const config = require('../gas_app/js/config');

// Config.gs はGAS用のグローバル定義のため、vm上で評価して CONFIG を取り出す
const gasSource = fs.readFileSync(path.join(__dirname, '..', 'gas_app', 'Config.gs'), 'utf8');
const sandbox = {};
vm.runInNewContext(gasSource, sandbox);
// vmコンテキスト由来のオブジェクトはプロトタイプが異なるため、JSON経由で素のオブジェクトに揃える
const CONFIG = JSON.parse(JSON.stringify(sandbox.CONFIG));

console.log('=== Test 1: 品種8大分類キー ===');
assert.deepStrictEqual(CONFIG.VARIETY_KEYS, config.VARIETY_GROUPS.map(g => g.key), 'VARIETY_KEYS が一致しません');
console.log('VARIETY_KEYS PASSED!');

console.log('=== Test 2: 品種合算マッピング ===');
assert.deepStrictEqual(CONFIG.VARIETY_MAPPING, config.VARIETY_MAPPING, 'VARIETY_MAPPING が一致しません');
console.log('VARIETY_MAPPING PASSED!');

console.log('=== Test 3: カテゴリ一覧 ===');
assert.deepStrictEqual(
  CONFIG.CATEGORIES,
  config.CATEGORIES.map(c => ({ key: c.key, name: c.name })),
  'CATEGORIES が一致しません'
);
console.log('CATEGORIES PASSED!');

console.log('=== Test 4: 1時間集計シート 90列 ===');
assert.strictEqual(CONFIG.COLUMNS.length, 90, 'COLUMNS は90列である必要があります');
assert.deepStrictEqual(
  CONFIG.COLUMNS,
  config.EQUIPMENT_COLUMNS.map(c => ({ col: c.col, label: c.label })),
  'COLUMNS が一致しません'
);
console.log('COLUMNS PASSED!');

console.log('=== Test 5: グラフ目盛りスケール設定 ===');
assert.deepStrictEqual(CONFIG.SCALE_CONFIG, config.SCALE_CONFIG, 'SCALE_CONFIG が一致しません');
console.log('SCALE_CONFIG PASSED!');

console.log('=== Test 6: トータルエネルギー集約シートの列 ===');
assert.deepStrictEqual(CONFIG.TOTAL_ENERGY_SHEET_COLUMNS, config.TOTAL_ENERGY_SHEET_COLUMNS, 'TOTAL_ENERGY_SHEET_COLUMNS が一致しません');
console.log('TOTAL_ENERGY_SHEET_COLUMNS PASSED!');

console.log('CONFIG SYNC VERIFIED SUCCESSFULLY!');
