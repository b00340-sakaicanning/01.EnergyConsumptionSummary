/**
 * tests/verify_excel_reader.js
 * 月報PET・エネルギー計算表の解析 (gas_app/js/etl/excelReader.js) の検証テスト
 * 対象年度のシートが無い場合や、対象月が未入力の場合に、別の年度・別のセルの値を取り込まないことを確認する
 *
 * SheetJS が無くても動くよう、シートの内容を2次元配列で直接与える模擬のワークブックを使う
 */

const assert = require('assert');

// excelReader.js は XLSX.utils.sheet_to_json(ws, { header: 1 }) の結果 (2次元配列) だけを使う
global.XLSX = { utils: { sheet_to_json: ws => ws.rows } };
const ExcelReader = require('../gas_app/js/etl/excelReader');

const FISCAL_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const makeWorkbook = sheets => ({ SheetNames: Object.keys(sheets), Sheets: Object.fromEntries(Object.entries(sheets).map(([n, rows]) => [n, { rows }])) });

/**
 * 月報PETの年度シートを組み立てる (月ごとに12列幅のブロック。4月のブロックはB列始まり)
 * @param {Object} months { [月]: { total, varieties: [{ name, fill, iri, cs }] } }
 */
function buildPetSheet(months) {
  const rows = Array.from({ length: 60 }, () => []);
  for (const [month, info] of Object.entries(months)) {
    const base = FISCAL_MONTHS.indexOf(Number(month)) * 12 + 1;
    rows[4][base] = '実績（本)';
    if (info.total !== undefined) rows[4][base + 1] = info.total;
    (info.varieties || []).forEach((v, k) => {
      const r = 11 + k * 8;
      rows[r][base + 2] = v.name;
      rows[r + 1][base] = '入数（本）';
      if (v.iri !== undefined) rows[r + 1][base + 1] = v.iri;
      rows[r + 2][base] = '実績（C/S)';
      if (v.cs !== undefined) rows[r + 2][base + 1] = v.cs;
      rows[r + 1][base + 8] = '充填本数';
      if (v.fill !== undefined) rows[r + 1][base + 9] = v.fill;
    });
  }
  return rows;
}

console.log('=== Test 1: 月報PET 通常の月 ===');
const petSheet2024 = buildPetSheet({
  4: { total: 1000, varieties: [{ name: '2.0L', fill: 600 }, { name: '500ｍｌ丸', iri: 24, cs: 10 }, { name: '550ml丸', fill: 160 }] },
  1: { total: 500, varieties: [{ name: '1.5L', fill: 500 }] },
  10: {} // ラベルだけあって本数が未入力の月
});
// 4月ブロックの中の、本数とは無関係なセル (10月を「4月=C列始まりの1列1か月」とみなした場合の位置)
petSheet2024[4][8] = 777777;
const petWb = makeWorkbook({
  '月報PET(2024）': petSheet2024,
  '月報PET(2025)': buildPetSheet({ 4: { total: 2000, varieties: [{ name: '2.0L', fill: 2000 }] } })
});

let res = ExcelReader.parsePetMonthlyReport(petWb, '202404');
assert.strictEqual(res.sheetFound, true, '2024年度のシートが見つかること');
assert.strictEqual(res.totalBottles, 1000, '2024年4月の総本数');
assert.deepStrictEqual(res.varieties, { '2.0L': 600, '500mL丸': 240 + 160 }, '充填本数を優先し、無ければ 入数×C/S。550ml丸は500mL丸に合算');

res = ExcelReader.parsePetMonthlyReport(petWb, '202501');
assert.strictEqual(res.totalBottles, 500, '2025年1月は2024年度のシートの1月ブロックを読むこと');
assert.deepStrictEqual(res.varieties, { '1.5L': 500 });

res = ExcelReader.parsePetMonthlyReport(petWb, '202504');
assert.strictEqual(res.totalBottles, 2000, '2025年4月は2025年度のシートを読むこと');
console.log('PET normal months PASSED!');

console.log('=== Test 2: 月報PET 対象年度のシートが無い ===');
res = ExcelReader.parsePetMonthlyReport(petWb, '202304');
assert.strictEqual(res.sheetFound, false, '2023年度のシートは無い');
assert.strictEqual(res.totalBottles, 0, '先頭のシート (2024年度) の値を取り込まないこと');
assert.deepStrictEqual(res.varieties, {});

res = ExcelReader.parsePetMonthlyReport(petWb, '202401');
assert.strictEqual(res.sheetFound, false, '2024年1月は2023年度。暦年が一致する2024年度のシートを読まないこと');
assert.strictEqual(res.totalBottles, 0);
assert.deepStrictEqual(res.varieties, {});

res = ExcelReader.parsePetMonthlyReport(makeWorkbook({ '20245': petSheet2024 }), '202404');
assert.strictEqual(res.sheetFound, false, '年度の数字が他の数字の一部になっているシート名は対象にしないこと');
assert.strictEqual(res.totalBottles, 0);
console.log('PET missing fiscal year sheet PASSED!');

console.log('=== Test 3: 月報PET 対象月が未入力 ===');
res = ExcelReader.parsePetMonthlyReport(petWb, '202410');
assert.strictEqual(res.sheetFound, true);
assert.strictEqual(res.totalBottles, 0, '未入力の月は 0。ブロックの外の無関係なセルを拾わないこと');
assert.deepStrictEqual(res.varieties, {});

res = ExcelReader.parsePetMonthlyReport(petWb, '202412');
assert.strictEqual(res.totalBottles, 0, 'ブロック自体が無い月も 0');
console.log('PET empty month PASSED!');

console.log('=== Test 4: エネルギー計算表 ===');
const energyRow = (a, b, values) => { const row = [a, b]; values.forEach((v, i) => { row[i + 2] = v; }); return row; };
const used2024 = [285.482, 280.121, 294.771, 333.549, 339.627, 312.874, 248.984, 272.268, 265.157, 221.046, 228.965, 288.075];
const cost2024 = [5526.867, 5924.695, 6354.344, 7532.392, 7579.785, 6381.192, 5276.421, 6035.126, 6337.216, 5388.385, 5160.938, 6176.992];
const energyWb = makeWorkbook({
  // 年度のシートではないが、同じ見出しの行を持つシート (年度のシートが無いときに読んではいけない)
  '年度推移_予測用（二次関数）': [energyRow('使用電力', '千ｋWh', Array(12).fill(999)), energyRow('※税込み', '使用量（千円）', Array(12).fill(99999))],
  '2024': [
    energyRow('使用電力', '千ｋWh', used2024),
    energyRow('昼間', '千ｋWh', Array(12).fill(1)),
    energyRow('夜間', '千ｋWh', Array(12).fill(2)),
    energyRow('※税込み', '使用量（千円）', cost2024)
  ],
  '2025': [energyRow('使用電力', '千ｋWh', [300, '', '', '', '', '', '', '', '', '', '', '']), energyRow('※税込み', '使用量（千円）', [6000, '', '', '', '', '', '', '', '', '', '', ''])]
});

res = ExcelReader.parseEnergyCalculationTable(energyWb, '202404');
assert.strictEqual(res.sheetFound, true);
assert.strictEqual(res.usedKwhThousand, 285.482);
assert.strictEqual(res.costThousandYen, 5526.867);
assert.ok(Math.abs(res.unitPriceYenPerKwh - 5526.867 / 285.482) < 1e-12, '単価 = 金額 ÷ 使用電力量');

res = ExcelReader.parseEnergyCalculationTable(energyWb, '202503');
assert.strictEqual(res.usedKwhThousand, 288.075, '2025年3月は2024年度のシートの3月の列を読むこと');
assert.ok(Math.abs(res.unitPriceYenPerKwh - 21.4423) < 1e-4);

res = ExcelReader.parseEnergyCalculationTable(energyWb, '202304');
assert.strictEqual(res.sheetFound, false, '2023年度のシートは無い');
assert.strictEqual(res.unitPriceYenPerKwh, null, '予測用シートや先頭のシートの値を取り込まないこと');
assert.strictEqual(res.usedKwhThousand, null);

res = ExcelReader.parseEnergyCalculationTable(energyWb, '202505');
assert.strictEqual(res.sheetFound, true);
assert.strictEqual(res.unitPriceYenPerKwh, null, '対象月が空欄なら単価は null');
console.log('Energy calculation table PASSED!');

console.log('=== Test 5: エネルギー計算表 燃料 (A重油・LNG) の読み取り ===');
// 月見出し行に入る日付 (Excelのシリアル値)
const serial = (year, month) => (Date.UTC(year, month - 1, 1) - Date.UTC(1899, 11, 30)) / 86400000;
const headerRow = fy => energyRow('', '税込', FISCAL_MONTHS.map(mo => serial(mo >= 4 ? fy : fy + 1, mo)));
const seq = (start, step) => FISCAL_MONTHS.map((_, i) => start + i * step);
/**
 * 年度シートの燃料まわりの行を組み立てる (実ファイルと同じ並び。行番号は年度で変わるため、先頭の空行数を変えられるようにしている)
 */
function buildFuelSheet(fy, options = {}) {
  const rows = [];
  for (let i = 0; i < (options.leadingRows || 3); i++) rows.push([]);
  // 年間サマリ (月見出し行より上にも A重油・LNG の文字がある)
  rows.push(['A重油', '年間', 1, 2]);
  rows.push(['LNG', '年間', 3, 4]);
  rows.push(headerRow(options.headerFiscalYear || fy));
  rows.push(energyRow('A重油', '前月末残(kl)', seq(10, 1)));
  rows.push(energyRow('', '入荷合計', seq(20, 1)));
  rows.push(energyRow('※税込み', '購入費用（千円）', options.oilCost || seq(1000, 10)));
  rows.push(energyRow('', '使用量（ｋｌ）', seq(5, 1)));
  rows.push(energyRow('A重油(本社）', '入荷合計', Array(12).fill(7)));
  rows.push(energyRow('※税込み', '費用（千円）', Array(12).fill(77777)));
  rows.push(energyRow(38.9, '熱量GJ', options.oilHeat || seq(300, 5)));
  rows.push(energyRow(0.0193, 't-CO2', seq(1, 0)));
  rows.push(energyRow('LNG', '前月末残(t)', seq(15, 0)));
  rows.push(energyRow('', '使用量（t）', seq(90, 1)));
  rows.push(energyRow(54.7, '熱量GJ', options.lngHeat || seq(5000, 100)));
  rows.push(energyRow(0.0139, 't-CO2', seq(1, 0)));
  if (!options.noLngCostRow) rows.push(energyRow(0.1, '購入費用（千円）　※税込み', options.lngCost || seq(9000, 50)));
  rows.push(energyRow('使用電力', '千ｋWh', seq(280, 1)));
  rows.push(energyRow('', '熱量GJ', Array(12).fill(88888)));
  rows.push(energyRow('※税込み', '使用量（千円）', seq(6000, 1)));
  rows.push(energyRow('太陽光発電量', '千ｋWh', seq(20, 0)));
  rows.push(energyRow(8.64, '熱量GJ', Array(12).fill(99999)));
  return rows;
}
const blankLate = values => values.map((v, i) => (i >= 6 ? '' : v)); // 10月以降が未入力
const fuelWb = makeWorkbook({
  '年度推移_予測用（二次関数）': buildFuelSheet(2024),
  '2024': buildFuelSheet(2024),
  '2025': buildFuelSheet(2025, { leadingRows: 9, oilCost: blankLate(seq(1000, 10)), oilHeat: seq(300, 5).map((v, i) => (i >= 6 ? 0 : v)), lngHeat: seq(5000, 100).map((v, i) => (i >= 6 ? 0 : v)) }),
  '2015': buildFuelSheet(2015, { noLngCostRow: true, lngHeat: Array(12).fill(0) }),
  '2016': buildFuelSheet(2016, { noLngCostRow: true }),
  '2022': buildFuelSheet(2022, { headerFiscalYear: 2021 })
});

res = ExcelReader.parseFuelEnergyTable(fuelWb, 2024);
assert.strictEqual(res.sheetFound, true);
assert.strictEqual(res.layoutFound, true);
assert.deepStrictEqual(Object.keys(res.months), ['202404', '202405', '202406', '202407', '202408', '202409', '202410', '202411', '202412', '202501', '202502', '202503']);
assert.deepStrictEqual(res.months['202404'], { heavyOilGj: 300, lngGj: 5000, heavyOilCostThousandYen: 1000, lngCostThousandYen: 9000 },
  'A重油(本社）の費用や、電気・太陽光の熱量GJを読まないこと');
assert.deepStrictEqual(res.months['202503'], { heavyOilGj: 355, lngGj: 6100, heavyOilCostThousandYen: 1110, lngCostThousandYen: 9550 }, '3月は年度の最後の列');

res = ExcelReader.parseFuelEnergyTable(fuelWb, '2025');
assert.strictEqual(res.layoutFound, true, '行の位置が年度で変わっても読めること');
assert.strictEqual(res.months['202504'].heavyOilGj, 300);
assert.deepStrictEqual(res.months['202510'], { heavyOilGj: 0, lngGj: 0, heavyOilCostThousandYen: null, lngCostThousandYen: 9300 }, '空欄のセルは null、数式が返す 0 は 0');

res = ExcelReader.parseFuelEnergyTable(fuelWb, 2023);
assert.strictEqual(res.sheetFound, false, '年度のシートが無い場合は、予測用シートなどで代用しないこと');
assert.strictEqual(res.layoutFound, false);
assert.deepStrictEqual(res.months, {});

res = ExcelReader.parseFuelEnergyTable(fuelWb, 2015);
assert.strictEqual(res.layoutFound, true, 'LNGの費用の行が無くても、LNGを使っていない年度は読めること');
assert.strictEqual(res.months['201504'].lngCostThousandYen, null);
assert.strictEqual(res.months['201504'].heavyOilGj, 300);

res = ExcelReader.parseFuelEnergyTable(fuelWb, 2016);
assert.strictEqual(res.sheetFound, true);
assert.strictEqual(res.layoutFound, false, 'LNGを使っているのに費用の行が無い年度は、費用が不完全になるため読まないこと');
assert.deepStrictEqual(res.months, {});

res = ExcelReader.parseFuelEnergyTable(fuelWb, 2022);
assert.strictEqual(res.layoutFound, false, '月見出しの年月が対象年度と合わないシートは読まないこと');
console.log('Fuel energy table PASSED!');

console.log('EXCEL READER VERIFIED SUCCESSFULLY!');
