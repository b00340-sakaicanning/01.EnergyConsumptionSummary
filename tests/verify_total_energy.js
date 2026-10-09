/**
 * tests/verify_total_energy.js
 * トータルエネルギーの読み取り (excelReader.parseTotalEnergyTable)、集計 (totalEnergyService.js)、
 * 画面のデータ処理 (totalEnergyView.js の DOM を使わない関数) の検証 (模擬シートを使用)
 * - 年度シートの行をラベルで探すこと (行位置のずれ、昼夜別の行、太陽光の行の有無)
 * - 原単位・CO2 の比、累計、年間計、前年度比、年度推移
 * - 表示・保存の対象にする年度、反映済みの判定、グラフ・表に並べる値、目盛り上限
 *
 * 実行: node tests/verify_total_energy.js
 */

const assert = require('assert');

// SheetJS の代わりに、行の配列をそのまま返す模擬を使う
global.XLSX = { utils: { sheet_to_json: ws => ws.rows } };
const ExcelReader = require('../gas_app/js/etl/excelReader');
const Service = require('../gas_app/js/services/totalEnergyService');
const View = require('../gas_app/js/totalEnergyView');

const FISCAL_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const makeWorkbook = sheets => ({ SheetNames: Object.keys(sheets), Sheets: Object.fromEntries(Object.entries(sheets).map(([n, rows]) => [n, { rows }])) });
const energyRow = (a, b, values) => { const row = [a, b]; (values || []).forEach((v, i) => { row[i + 2] = v; }); return row; };
const serial = (year, month) => (Date.UTC(year, month - 1, 1) - Date.UTC(1899, 11, 30)) / 86400000;
const fill12 = v => Array(12).fill(v);
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} (期待 ${expected})`);

/**
 * エネルギー計算表の年度シート (トータルエネルギーに関係する行と、取り違えやすい行)
 * options: leadingRows, dayNight (昼夜別の行), solar (太陽光の行), noProductionRow, headerFiscalYear, 各行の値
 */
function buildTotalSheet(fy, options = {}) {
  const o = Object.assign({
    leadingRows: 3, dayNight: true, solar: true,
    oilHeat: fill12(300), oilCo2: fill12(20), lngHeat: fill12(5000), lngCo2: fill12(250),
    powerHeat: fill12(2500), powerCo2: fill12(120), solarKwh: fill12(20), solarHeat: fill12(170), solarCo2: fill12(8),
    totalGj: fill12(7800), totalCo2: fill12(390), crudeOil: fill12(200), noSolarCrudeOil: fill12(205), cases: fill12(800000)
  }, options);
  const rows = [];
  for (let i = 0; i < o.leadingRows; i++) rows.push([]);
  // 年間サマリー (月見出し行より上にも、同じラベルの行がある)
  rows.push(['A重油', '熱量GJ', 1, 2]);
  rows.push(['合計GJ', '', 3, 4]);
  rows.push(energyRow('', '税込', FISCAL_MONTHS.map(mo => serial(mo >= 4 ? (o.headerFiscalYear || fy) : (o.headerFiscalYear || fy) + 1, mo))));
  rows.push(energyRow('A重油', '前月末残(kl)', fill12(10)));
  rows.push(energyRow('※税込み', '購入費用（千円）', fill12(1000)));
  rows.push(energyRow('A重油(本社）', '入荷合計', fill12(0)));
  rows.push(energyRow(38.9, '熱量GJ', o.oilHeat));
  rows.push(energyRow(0.0193, 't-CO2', o.oilCo2));
  rows.push(energyRow('LNG', '前月末残(t)', fill12(15)));
  rows.push(energyRow(54.7, '熱量GJ', o.lngHeat));
  rows.push(energyRow(0.0139, 't-CO2', o.lngCo2));
  rows.push(energyRow('使用電力', '千ｋWh', fill12(280)));
  if (o.dayNight) {
    rows.push(energyRow('使用電力（昼間）', '千ｋWh', fill12(160)));
    rows.push(energyRow('使用電力（夜間）', '千ｋWh', fill12(120)));
  }
  rows.push(energyRow(o.dayNight ? '' : 9.76, '熱量GJ', o.powerHeat));
  if (o.dayNight) {
    rows.push(energyRow(8.64, '熱量GJ（昼間）', fill12(11111)));
    rows.push(energyRow(8.64, '熱量GJ（夜間）', fill12(22222)));
  }
  rows.push(energyRow(0.000419, 't-CO2', o.powerCo2));
  rows.push(energyRow('※税込み', '使用量（千円）', fill12(6000)));
  if (o.solar) {
    rows.push(energyRow('太陽光発電量', '千ｋWh', o.solarKwh));
    rows.push(energyRow(8.64, '熱量GJ', o.solarHeat));
    rows.push(energyRow(0.000419, 't-CO2', o.solarCo2));
  }
  rows.push(energyRow('合計GJ', 0.0258, o.totalGj));
  rows.push(energyRow('合計t-CO2', '', o.totalCo2));
  rows.push(energyRow('合計GJ原油換算量', 'ｋｌ', o.crudeOil));
  if (o.solar) {
    rows.push(['太陽光発電　無しの想定値（青字）']);
    rows.push(energyRow('合計GJ', 0.0258, fill12(77777)));
    rows.push(energyRow('合計t-CO2', '', fill12(88888)));
    rows.push(energyRow('合計GJ原油換算量', 'ｋｌ', o.noSolarCrudeOil));
  }
  rows.push(energyRow('PET生産量', 12, fill12(790000)));
  rows.push(energyRow('', '総ケース', fill12(790000)));
  rows.push(energyRow('CUP生産量', 'ケース', fill12(10000)));
  if (!o.noProductionRow) {
    rows.push(energyRow('生産数量', 'ケース', o.cases));
    rows.push(energyRow('', '千ケース', o.cases.map(v => Math.round(v / 1000))));
  }
  rows.push(energyRow('原単位', 'kl/千ケース', fill12(0.25)));
  // 下の参考欄にも、同じラベルの行がある
  rows.push(energyRow('生産数量', '千ケース', fill12(999)));
  rows.push(energyRow('合計', '熱量GJ', fill12(66666)));
  return rows;
}

console.log('=== Test 1: 年度シートの読み取り (昼夜別・太陽光の行がある年度) ===');
const blankLate = values => values.map((v, i) => (i >= 6 ? '' : v)); // 10月以降が未入力 (式が空文字を返す)
const wb = makeWorkbook({
  '年度推移_予測用': buildTotalSheet(2024),
  '2024': buildTotalSheet(2024),
  '2013': buildTotalSheet(2013, { leadingRows: 8, dayNight: false, solar: false, lngHeat: fill12(0), lngCo2: fill12(0) }),
  '2026': buildTotalSheet(2026, { totalGj: fill12(7800).map((v, i) => (i >= 6 ? 0 : v)), cases: blankLate(fill12(800000)), crudeOil: blankLate(fill12(200)) }),
  '2030': buildTotalSheet(2030, { noProductionRow: true }),
  '2031': buildTotalSheet(2031, { headerFiscalYear: 2029 })
});
const t2024 = ExcelReader.parseTotalEnergyTable(wb, 2024);
assert.strictEqual(t2024.sheetFound, true);
assert.strictEqual(t2024.layoutFound, true);
assert.strictEqual(t2024.hasSolar, true);
assert.deepStrictEqual(Object.keys(t2024.months), ['202404', '202405', '202406', '202407', '202408', '202409', '202410', '202411', '202412', '202501', '202502', '202503']);
assert.deepStrictEqual(t2024.months['202404'], {
  productionCases: 800000, litersPerCase: 12,
  heavyOilGj: 300, lngGj: 5000, electricityGj: 2500, totalGj: 7800, crudeOilKl: 200,
  heavyOilCo2: 20, lngCo2: 250, electricityCo2: 120, totalCo2: 390,
  solarKwhThousand: 20, solarGj: 170, solarCo2: 8, noSolarCrudeOilKl: 205
}, '電気の熱量は合計の行 (昼間・夜間の行や太陽光の行ではない)、合計は最初の行 (太陽光無し想定の行ではない)');
console.log('OK');

console.log('=== Test 2: 行位置が違う年度 (昼夜別・太陽光の行が無い、LNG を使っていない) ===');
const t2013 = ExcelReader.parseTotalEnergyTable(wb, '2013');
assert.strictEqual(t2013.layoutFound, true);
assert.strictEqual(t2013.hasSolar, false);
const m2013 = t2013.months['201304'];
assert.strictEqual(m2013.electricityGj, 2500);
assert.strictEqual(m2013.lngGj, 0);
assert.strictEqual(m2013.totalGj, 7800);
assert.strictEqual(m2013.productionCases, 800000);
assert.deepStrictEqual([m2013.solarKwhThousand, m2013.solarGj, m2013.solarCo2, m2013.noSolarCrudeOilKl], [null, null, null, null], '太陽光の行が無い年度は null');
console.log('OK');

console.log('=== Test 3: 読めない場合・未入力の月 ===');
assert.deepStrictEqual(ExcelReader.parseTotalEnergyTable(wb, 2012), { fiscalYear: 2012, sheetFound: false, layoutFound: false, hasSolar: false, months: {} }, '年度のシートが無い (別のシートで代用しない)');
assert.strictEqual(ExcelReader.parseTotalEnergyTable(wb, 2030).layoutFound, false, '生産数量(ケース)の行が無い');
assert.strictEqual(ExcelReader.parseTotalEnergyTable(wb, 2031).layoutFound, false, '月見出しの年度が合わない');
const t2026 = ExcelReader.parseTotalEnergyTable(wb, 2026);
assert.strictEqual(t2026.months['202609'].productionCases, 800000);
assert.strictEqual(t2026.months['202610'].productionCases, null, '空欄は null');
assert.strictEqual(t2026.months['202610'].totalGj, 0);
console.log('OK');

console.log('=== Test 4: 月別の比・累計・年間計 ===');
const month = (cases, kl, co2, extra) => Object.assign({
  productionCases: cases, litersPerCase: 12, heavyOilGj: 100, lngGj: 200, electricityGj: 300, totalGj: 600, crudeOilKl: kl,
  heavyOilCo2: 1, lngCo2: 2, electricityCo2: 3, totalCo2: co2, solarKwhThousand: null, solarGj: null, solarCo2: null, noSolarCrudeOilKl: null
}, extra || {});
const monthly2024 = { '202404': month(1000000, 250, 480), '202405': month(500000, 150, 300), '202406': Object.assign(month(0, 0, 0), { totalGj: 0 }) };
const ds = Service.buildAnnualDataset(2024, monthly2024);
assert.strictEqual(ds.availableMonthsCount, 2, '熱量の合計が 0 の月はデータなし');
assert.strictEqual(ds.rows['202406'].hasData, false);
assert.strictEqual(ds.rows['202503'].hasData, false, '入力の無い月もデータなし');
const apr = ds.rows['202404'];
close(apr.productionThousandCases, 1000, '千ケース');
close(apr.intensity, 0.25, '原単位 = 250kl ÷ 1000千ケース');
close(apr.co2PerKl, 40, '1klあたり = 480t × 1000 ÷ (1,000,000ケース × 12L ÷ 1000)');
close(apr.co2PerThousandCases, 0.48, '千ケースあたり');
close(ds.rows['202405'].intensity, 0.3, '5月の原単位');
close(ds.rows['202405'].cumulative.crudeOilKl, 400, '累計の原油換算量');
close(ds.rows['202405'].cumulative.intensity, 400 / 1500, '累計の原単位は、累計どうしの比 (月の値の平均ではない)');
close(ds.annual.totalGj, 1200, '年間の熱量');
close(ds.annual.heavyOilCo2, 2, '年間の A重油の CO2');
close(ds.annual.intensity, 400 / 1500, '年間の原単位');
close(ds.annual.co2PerKl, 780 * 1000 / (1500000 * 12 / 1000), '年間の 1klあたり CO2');
assert.strictEqual(ds.annual.monthsCount, 2);
assert.strictEqual(ds.hasSolar, false);
assert.strictEqual(apr.noSolarIntensity, null, '太陽光の値が無い年度は、無し想定も null');
// 生産数量が 0 で熱量だけがある月は、比を出さない
const noProduction = Service.buildAnnualDataset(2024, { '202404': month(0, 10, 5) });
assert.strictEqual(noProduction.rows['202404'].hasData, true);
assert.strictEqual(noProduction.rows['202404'].intensity, null);
assert.strictEqual(noProduction.rows['202404'].co2PerKl, null);
assert.strictEqual(Service.buildAnnualDataset(2024, {}).annual, null, 'データが無ければ年間計も無い');
console.log('OK');

console.log('=== Test 5: 太陽光発電 無しの想定値 ===');
const solarDs = Service.buildAnnualDataset(2024, { '202404': month(1000000, 250, 480, { solarKwhThousand: 20, solarGj: 170, solarCo2: 8, noSolarCrudeOilKl: 255 }) });
assert.strictEqual(solarDs.hasSolar, true);
close(solarDs.rows['202404'].noSolarTotalGj, 770, '合計GJ に太陽光の熱量を足し戻す');
close(solarDs.rows['202404'].noSolarTotalCo2, 488, '合計 CO2 に太陽光分を足し戻す');
close(solarDs.rows['202404'].noSolarIntensity, 0.255, '無し想定の原単位');
close(solarDs.rows['202404'].noSolarCo2PerKl, 488 * 1000 / 12000, '無し想定の 1klあたり CO2');
console.log('OK');

console.log('=== Test 6: 前年度比・年度推移 ===');
const fullYear = (fy, kl) => { const m = {}; FISCAL_MONTHS.forEach(mo => { m[`${mo >= 4 ? fy : fy + 1}${String(mo).padStart(2, '0')}`] = month(1000000, kl, 480); }); return m; };
const d2024 = Service.buildAnnualDataset(2024, fullYear(2024, 250));
const d2025 = Service.buildAnnualDataset(2025, fullYear(2025, 200));
const d2026 = Service.buildAnnualDataset(2026, { '202604': month(1000000, 220, 480), '202605': month(1000000, 220, 480) });
const r2025 = Service.compareWithPreviousYear(d2025, d2024);
close(r2025.intensity, 0.8, '原単位の前年度比');
close(r2025.crudeOilKl, 0.8, '12か月そろっていれば、総量の前年度比も求める');
close(r2025.productionCases, 1, '生産数量の前年度比');
const r2026 = Service.compareWithPreviousYear(d2026, d2025);
close(r2026.intensity, 1.1, '入力途中の年度でも、原単位の前年度比は求める');
assert.strictEqual(r2026.crudeOilKl, null, '入力途中の年度は、総量の前年度比を求めない');
assert.deepStrictEqual(Service.compareWithPreviousYear(d2024, null), { intensity: null, co2PerKl: null, productionCases: null, crudeOilKl: null, totalCo2: null }, '前年度が無ければ求めない');
const trend = Service.buildYearlyTrend({ 2026: d2026, 2024: d2024, 2025: d2025, 2027: Service.buildAnnualDataset(2027, {}) });
assert.deepStrictEqual(trend.years, [2024, 2025, 2026], '年度の昇順。データの無い年度は含めない');
assert.deepStrictEqual(trend.labels, ['2024年度', '2025年度', '2026年度 (2ヶ月)'], '入力途中の年度は月数を添える');
close(trend.rows[2025].crudeOilKl, 2400, '年度推移の値は年間計');
close(trend.rows[2025].previousYearRatio.intensity, 0.8, '年度推移にも前年度比を持つ');
assert.strictEqual(trend.rows[2024].previousYearRatio.intensity, null, '最初の年度は前年度比なし');
console.log('OK');

console.log('=== Test 7: 画面のデータ処理 (対象年度・月次データ・反映済みの判定) ===');
const restored = { '202404': month(1000000, 250, 480), '202304': month(900000, 240, 470) };
assert.deepStrictEqual(View.resolveTargetYears([2026, 2024], restored), [2024, 2026], '月報PETが読み込まれていれば、月報PETにシートがある年度');
assert.deepStrictEqual(View.resolveTargetYears(null, restored), [2023, 2024], '月報PETが未読込なら、復元したデータのある年度');
assert.deepStrictEqual(View.resolveTargetYears(null, {}), []);
const merged = View.mergeMonthly(restored, [wb], [2024, 2026, 2030]);
assert.strictEqual(merged.monthly['202404'].crudeOilKl, 200, '対象年度は、エネルギー計算表の値に置き換わる');
assert.strictEqual(merged.monthly['202304'].crudeOilKl, 240, '対象年度以外は、既存の値のまま (読み直さない)');
assert.ok(merged.monthly['202609'] && !merged.monthly['202610'], '熱量の合計が 0 の月は取り込まない');
assert.deepStrictEqual(merged.skippedYears, [2030], '対象年度で必要な行を特定できない年度を報告する');
assert.strictEqual(restored['202404'].crudeOilKl, 250, '引数のデータは書き換えない');
assert.deepStrictEqual(Object.keys(View.buildAnnualDatasets(merged.monthly, [2024, 2026])).sort(), ['2024', '2026'], '対象年度だけの年間データセットを作る');
const sig = View.monthSignature(merged.monthly['202404']);
assert.strictEqual(View.monthSignature(JSON.parse(JSON.stringify(View.toSheetRow('202404', merged.monthly['202404'])))), sig, '保存用の行にして戻しても同じ署名');
assert.notStrictEqual(View.monthSignature(Object.assign({}, merged.monthly['202404'], { totalCo2: 391 })), sig, '値が変われば変わる');
assert.notStrictEqual(View.monthSignature(Object.assign({}, merged.monthly['202404'], { solarGj: null })), View.monthSignature(Object.assign({}, merged.monthly['202404'], { solarGj: 0 })), '値なしと 0 は区別する');
console.log('OK');

console.log('=== Test 8: グラフ・表に並べる値と目盛り上限 ===');
const allDs = { 2024: d2024, 2025: d2025, 2026: d2026 };
const monthlySeries = View.buildSeries('monthly', allDs, 2026);
assert.strictEqual(monthlySeries.labels.length, 12);
assert.strictEqual(monthlySeries.rowLabels[0], '4月 (202604)');
close(monthlySeries.points[1].extra, 0.22, '月別の追加列は累計の原単位');
assert.strictEqual(monthlySeries.points[2], null, 'データの無い月は null');
close(monthlySeries.total.crudeOilKl, 440, '月別は年間計の行を持つ');
const yearlySeries = View.buildSeries('yearly', allDs, 2026);
assert.deepStrictEqual(yearlySeries.labels, ['2024年度', '2025年度', '2026年度 (2ヶ月)']);
close(yearlySeries.points[1].extra, 0.8, '年度推移の追加列は原単位の前年度比');
assert.strictEqual(yearlySeries.points[0].extra, null, '最初の年度は前年度比なし');
assert.strictEqual(yearlySeries.total, null, '年度推移は合計の行を持たない');
assert.deepStrictEqual(View.buildSeries('monthly', allDs, 2030).points, [], '対象年度のデータが無ければ空');
const stubChart = { getNiceMax: v => ['nice', v], getAxisMaxForPeak: (v, r) => ['peak', v, r] };
const layout = { rateBarPeakRatio: 0.6, rateLinePeakRatio: 0.9, trendPeakRatio: 0.9 };
const monthlyScale = View.computeScales('monthly', allDs, layout, stubChart);
assert.deepStrictEqual(monthlyScale.heat, ['nice', 600], '月別は、全年度の月別の最大値から求める');
assert.deepStrictEqual(monthlyScale.crudeOil, ['peak', 250, 0.6]);
assert.deepStrictEqual(monthlyScale.production, ['peak', 1000, 0.9]);
const yearlyScale = View.computeScales('yearly', allDs, layout, stubChart);
assert.deepStrictEqual(yearlyScale.heat, ['nice', 7200], '年度推移は、年間値の最大値から求める');
assert.deepStrictEqual(yearlyScale.crudeOil, ['peak', 3000, 0.6]);
console.log('OK');

console.log('\nTOTAL ENERGY VERIFIED SUCCESSFULLY!');
