/**
 * tests/verify_fuel_view.js
 * 燃料エネルギー画面 (fuelView.js) のデータ処理の検証 (DOMを使わない関数のみ。模擬シートを使用)
 * - 表示・保存の対象にする年度の決め方 (月報PETにシートがある年度。未読込のときは、品種別本数が保存されている年度)
 * - 読み込んだExcelから月次データを作るルール (読み込んだ種類だけ取り直し、読み込んでいない種類は既存の値を引き継ぐ)
 * - スプレッドシートへ反映済みかどうかの判定に使う署名
 * - 品種内訳の無い月の月計、目盛り上限、年度の範囲表記
 *
 * 実行: node tests/verify_fuel_view.js
 */

const assert = require('assert');

// SheetJS の代わりに、行の配列をそのまま返す模擬を使う
global.XLSX = { utils: { sheet_to_json: ws => ws.rows } };
const AppConfig = require('../gas_app/js/config');
const ExcelReader = require('../gas_app/js/etl/excelReader');
const FuelView = require('../gas_app/js/fuelView');

const FISCAL_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const makeWorkbook = sheets => ({ SheetNames: Object.keys(sheets), Sheets: Object.fromEntries(Object.entries(sheets).map(([n, rows]) => [n, { rows }])) });
const energyRow = (a, b, values) => { const row = [a, b]; values.forEach((v, i) => { row[i + 2] = v; }); return row; };
const serial = (year, month) => (Date.UTC(year, month - 1, 1) - Date.UTC(1899, 11, 30)) / 86400000;
const fill12 = v => Array(12).fill(v);

/** エネルギー計算表の年度シート (燃料に関係する行だけ) */
function buildFuelSheet(fy, { oilHeat = fill12(300), lngHeat = fill12(5000), oilCost = fill12(1000), lngCost = fill12(9000), noLngCostRow = false } = {}) {
  const rows = [[], []];
  rows.push(energyRow('', '税込', FISCAL_MONTHS.map(mo => serial(mo >= 4 ? fy : fy + 1, mo))));
  rows.push(energyRow('A重油', '前月末残(kl)', fill12(10)));
  rows.push(energyRow('※税込み', '購入費用（千円）', oilCost));
  rows.push(energyRow(38.9, '熱量GJ', oilHeat));
  rows.push(energyRow('LNG', '前月末残(t)', fill12(15)));
  rows.push(energyRow(54.7, '熱量GJ', lngHeat));
  if (!noLngCostRow) rows.push(energyRow(0.1, '購入費用（千円）　※税込み', lngCost));
  rows.push(energyRow('使用電力', '千ｋWh', fill12(280)));
  return rows;
}

/** 月報PETの年度シート。months: { [月]: [{ name, fill }] } */
function buildPetSheet(months) {
  const rows = Array.from({ length: 60 }, () => []);
  for (const [month, varieties] of Object.entries(months)) {
    const base = FISCAL_MONTHS.indexOf(Number(month)) * 12 + 1;
    rows[4][base] = '実績（本)';
    varieties.forEach((v, k) => {
      const r = 11 + k * 8;
      rows[r][base + 2] = v.name;
      rows[r + 1][base + 8] = '充填本数';
      rows[r + 1][base + 9] = v.fill;
    });
  }
  return rows;
}

console.log('=== Test 1: 年度の範囲表記 ===');
assert.strictEqual(FuelView.formatYearRanges([2013, 2014, 2015, 2018, 2019, 2023]), '2013〜2015、2018〜2019、2023');
assert.strictEqual(FuelView.formatYearRanges([2017, 2016]), '2016〜2017');
assert.strictEqual(FuelView.formatYearRanges([2023]), '2023');
assert.strictEqual(FuelView.formatYearRanges([]), '');
console.log('OK');

console.log('=== Test 2: 対象年度の決め方 ===');
const energyWb = makeWorkbook({
  '年度推移': buildFuelSheet(2024),
  '2023': buildFuelSheet(2023),
  '2024': buildFuelSheet(2024, { oilHeat: fill12(300).map((v, i) => (i >= 6 ? 0 : v)), lngHeat: fill12(5000).map((v, i) => (i >= 6 ? 0 : v)) }), // 10月以降は未入力
  '2017': buildFuelSheet(2017, { noLngCostRow: true }) // LNG を使っているのに費用の行が無い年度
});
const petWb = makeWorkbook({
  '月報PET(2024）': buildPetSheet({ 4: [{ name: '2.0L', fill: 600 }, { name: '550ml丸', fill: 160 }], 5: [{ name: '1.5L', fill: 500 }] })
});
assert.deepStrictEqual(ExcelReader.listSheetFiscalYears(petWb), [2024], '月報PETに年度のシートがある年度');
assert.deepStrictEqual(ExcelReader.listSheetFiscalYears(energyWb), [2017, 2023, 2024], '年度を含まないシート名は対象外');
// スプレッドシートから復元した状態を想定したデータ (2024年4月は本数あり、2023年4月は本数なし)
const restored = {
  '202404': { heavyOilGj: 111, lngGj: 222, heavyOilCostThousandYen: 333, lngCostThousandYen: 444, bottles: { '2.0L': 9 } },
  '202304': { heavyOilGj: 1, lngGj: 2, heavyOilCostThousandYen: 3, lngCostThousandYen: 4, bottles: null }
};
assert.deepStrictEqual(FuelView.resolveTargetYears([2025, 2024], restored), [2024, 2025], '月報PETが読み込まれていれば、月報PETにシートがある年度');
assert.deepStrictEqual(FuelView.resolveTargetYears([], restored), [], '月報PETに年度のシートが無ければ、対象年度なし');
assert.deepStrictEqual(FuelView.resolveTargetYears(null, restored), [2024], '月報PETが未読込なら、品種別本数が保存されている年度');
assert.deepStrictEqual(FuelView.resolveTargetYears(null, {}), [], 'データが無ければ対象年度なし');
console.log('OK');

console.log('=== Test 3: 対象年度だけを読み込む ===');
// エネルギー計算表だけを読み込み、月報PETも復元データも無い場合は、何も読み込まない
const energyOnlyNoTarget = FuelView.mergeFuelMonthly({}, [energyWb], [], FuelView.resolveTargetYears(null, {}));
assert.strictEqual(Object.keys(energyOnlyNoTarget.monthly).length, 0, '対象年度が無ければ、エネルギー計算表を読んでも月次データは増えない');
assert.deepStrictEqual(energyOnlyNoTarget.skippedYears, []);

// 月報PET (2024年度のシートのみ) とエネルギー計算表を読み込んだ場合
const targets = FuelView.resolveTargetYears(ExcelReader.listSheetFiscalYears(petWb), {});
const step2 = FuelView.mergeFuelMonthly({}, [energyWb], [petWb], targets);
assert.deepStrictEqual(Object.keys(step2.monthly).sort(), ['202404', '202405', '202406', '202407', '202408', '202409'], '2024年度の入力済み6ヶ月だけ (2023年度と、熱量が 0 の月は含めない)');
assert.deepStrictEqual(step2.skippedYears, [], '対象年度以外 (2017年度) は、読めなくても報告しない');
assert.strictEqual(step2.monthly['202404'].heavyOilGj, 300);
assert.strictEqual(step2.monthly['202404'].bottles['2.0L'], 600);
assert.strictEqual(step2.monthly['202404'].bottles['500mL丸'], 160, '550ml丸 は 500mL丸 に合算される');
assert.deepStrictEqual(Object.keys(step2.monthly['202404'].bottles), AppConfig.VARIETY_KEYS, '本数は8品種すべてのキーを持つ');
assert.strictEqual(step2.monthly['202406'].bottles, null, '対象年度の中で未入力の月は null');
// 対象年度のシートで燃料の行を特定できない場合は報告する
assert.deepStrictEqual(FuelView.mergeFuelMonthly({}, [energyWb], [], [2017, 2024]).skippedYears, [2017]);
console.log('OK');

console.log('=== Test 4: 読み込んでいない種類の値と、対象年度以外の値は、既存の値を引き継ぐ ===');
const petOnly = FuelView.mergeFuelMonthly(restored, [], [petWb], [2024]);
assert.strictEqual(petOnly.monthly['202404'].heavyOilGj, 111, '月報PETだけを読み込んでも、燃料の値は変わらない');
assert.strictEqual(petOnly.monthly['202404'].bottles['2.0L'], 600, '本数は読み込んだ月報PETの値に置き換わる');
const energyOnly = FuelView.mergeFuelMonthly(restored, [energyWb], [], FuelView.resolveTargetYears(null, restored));
assert.strictEqual(energyOnly.monthly['202404'].heavyOilGj, 300, '燃料の値は読み込んだエネルギー計算表の値に置き換わる');
assert.strictEqual(energyOnly.monthly['202404'].bottles['2.0L'], 9, 'エネルギー計算表だけを読み込んでも、本数は変わらない');
assert.strictEqual(energyOnly.monthly['202304'].heavyOilGj, 1, '対象年度以外 (2023年度) は、エネルギー計算表にシートがあっても読み直さない');
assert.strictEqual(petOnly.monthly['202304'].bottles, null, '対象年度以外の月は、月報PETでも取り直さない');
assert.strictEqual(restored['202404'].heavyOilGj, 111, '引数のデータは書き換えない');
console.log('OK');

console.log('=== Test 5: 反映済みの判定に使う署名 ===');
const base = step2.monthly['202404'];
const sig = FuelView.monthSignature(base);
assert.strictEqual(FuelView.monthSignature(JSON.parse(JSON.stringify(base))), sig, '同じ値なら同じ署名');
assert.strictEqual(FuelView.monthSignature(Object.assign({}, base, { lngGj: base.lngGj + 1e-9 })), sig, '保存・復元で生じる程度の誤差では変わらない');
assert.notStrictEqual(FuelView.monthSignature(Object.assign({}, base, { lngGj: base.lngGj + 0.001 })), sig, '燃料の値が変われば変わる');
assert.notStrictEqual(FuelView.monthSignature(Object.assign({}, base, { bottles: Object.assign({}, base.bottles, { '2.0L': 601 }) })), sig, '本数が変われば変わる');
assert.notStrictEqual(FuelView.monthSignature(Object.assign({}, base, { bottles: null })), FuelView.monthSignature(Object.assign({}, base, { bottles: {} })), '本数なし (null) と 本数 0 は区別する');
assert.strictEqual(FuelView.monthSignature(Object.assign({}, base, { lngCostThousandYen: null })), FuelView.monthSignature(Object.assign({}, base, { lngCostThousandYen: 0 })), '空欄の費用は 0 と同じ扱い');
console.log('OK');

console.log('=== Test 6: 年間データセット・品種内訳の無い月の月計・目盛り上限 ===');
// 2023年度 (月報PETにシートなし。復元データなどで月次データだけがある状態) と 2024年度
const withOldYear = Object.assign({}, step2.monthly, FuelView.mergeFuelMonthly({}, [energyWb], [], [2023]).monthly);
const opMinutes = { '202404': { '2.0L': 100, '500mL丸': 50 } };
assert.deepStrictEqual(Object.keys(FuelView.buildAnnualDatasets(withOldYear, opMinutes, [2024])), ['2024'], '対象年度だけの年間データセットを作る');
const datasets = FuelView.buildAnnualDatasets(withOldYear, opMinutes);
assert.deepStrictEqual(Object.keys(datasets).sort(), ['2023', '2024'], '対象年度を省略すると、データのある全年度');
const ds2024 = datasets['2024'];
// 4・5月は品種内訳あり、6〜9月は月計のみ、10月以降はデータなし
assert.deepStrictEqual(
  FuelView.buildTotalOnlySeries(ds2024.metrics.fuelMj, ds2024.months),
  [null, null, 5300000, 5300000, 5300000, 5300000, null, null, null, null, null, null]
);
assert.strictEqual(FuelView.buildTotalOnlySeries(ds2024.metrics.productionBottles, ds2024.months), null, '本数は、内訳の無い月には月計も無い');
assert.strictEqual(FuelView.buildTotalOnlySeries(datasets['2023'].metrics.fuelCostYen, datasets['2023'].months).filter(v => v !== null).length, 12);
assert.strictEqual(ds2024.metrics.operationMin.months['202404'].monthlyTotal, 150, '操業時間は電力側のデータから取る');
assert.strictEqual(ds2024.metrics.operationMin.months['202405'].hasData, false, '操業時間が無い月はデータなし');

// 目盛り上限は全年度の最大値から求める (年度を切り替えても変わらない)
const stubChart = { getNiceMax: v => ['nice', v], getAxisMaxForPeak: (v, ratio) => ['peak', v, ratio] };
const layout = { rateBarPeakRatio: 0.6, rateLinePeakRatio: 0.9, trendPeakRatio: 0.9 };
const metricOf = key => AppConfig.FUEL_METRICS.find(m => m.key === key);
const totalScale = FuelView.computeScale(datasets, metricOf('fuelMj'), layout, stubChart);
assert.deepStrictEqual(totalScale.max, ['nice', 5300000]);
assert.strictEqual(totalScale.trendMax[2], 0.9);
assert.strictEqual(totalScale.trendMax[1], 5300000, '推移グラフは品種別の最大値から求める (5月は 1.5L だけなので月計の全量)');
const rateScale = FuelView.computeScale(datasets, metricOf('mjPerBottle'), layout, stubChart);
assert.strictEqual(rateScale.barMax[2], 0.6);
assert.strictEqual(rateScale.lineMax[2], 0.9);
assert.ok(rateScale.barMax[1] > 0 && rateScale.lineMax[1] > 0);
console.log('OK');

console.log('\nFUEL VIEW VERIFIED SUCCESSFULLY!');
