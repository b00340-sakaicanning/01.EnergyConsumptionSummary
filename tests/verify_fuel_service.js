/**
 * tests/verify_fuel_service.js
 * 燃料エネルギーの集計 (gas_app/js/services/fuelService.js) の検証テスト
 * 参考Excel「月別燃料エネルギー使用量集約グラフ表示(2024).xlsx」の2024年4月・5月の値と突合する
 * (単位時間あたりの指標は、参考Excelが1時間あたり、アプリが1分あたりのため 60 で割って比較する)
 */

const assert = require('assert');
const config = require('../gas_app/js/config');
const FuelService = require('../gas_app/js/services/fuelService');

const KEYS = config.VARIETY_KEYS;
const byKey = values => { const o = {}; KEYS.forEach((k, i) => { o[k] = values[i]; }); return o; };
const near = (actual, expected, message) => assert.ok(
  Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-9),
  `${message}: expected ${expected}, got ${actual}`
);

// 参考Excelの入力値 (燃料エネルギー量&費用入力シート、実績値シートの本数・操業時間)
const fuelMonthly = {
  '202404': {
    heavyOilGj: 357.88, lngGj: 5045.528, heavyOilCostThousandYen: 1258.18, lngCostThousandYen: 10629.250796780001,
    bottles: byKey([3575337, 533584, 0, 0, 3186758, 2413196, 210724, 0])
  },
  '202405': {
    heavyOilGj: 116.7, lngGj: 5110.621, heavyOilCostThousandYen: 0, lngCostThousandYen: 9894.072320000001,
    bottles: byKey([1538138, 208110, 420614, 1932742, 5851919, 1359410, 264129, 0])
  }
};
const operationMin = {
  '202404': byKey([22121, 2712, 0, 0, 7962, 6706, 1073, 0]),
  '202405': byKey([11298, 1257, 2382, 4756, 14457, 3771, 1072, 0])
};

console.log('=== Test 1: 月の合計と燃料単価 ===');
const apr = FuelService.summarizeFuelMonth(fuelMonthly['202404']);
assert.strictEqual(apr.hasData, true);
near(apr.totalMj, 5403408, '2024年4月の燃料エネルギー (MJ)');
near(apr.totalCostYen, 11887430.79678, '2024年4月の燃料コスト (円)');
near(apr.unitPriceYenPerMj, 2.1999876368358633, '2024年4月の燃料単価 (円/MJ)');
assert.strictEqual(FuelService.summarizeFuelMonth({ heavyOilGj: 0, lngGj: 0, lngCostThousandYen: 940 }).hasData, false, '熱量が0の月はデータなし');
assert.strictEqual(FuelService.summarizeFuelMonth(null).hasData, false);
console.log('Monthly summary PASSED!');

console.log('=== Test 2: 品種別の按分と8指標 (2024年4月) ===');
const ds = FuelService.buildFuelAnnualDataset(2024, fuelMonthly, operationMin);
assert.deepStrictEqual(ds.months.slice(0, 2).concat(ds.months.slice(-1)), ['202404', '202405', '202503']);
assert.strictEqual(ds.availableMonthsCount, 2);
const m = key => ds.metrics[key].months['202404'];
near(m('fuelMj').monthlyTotal, 5403408, '燃料エネルギー 月計');
near(m('fuelMj').varieties['2.0L'], 3569403.5046652774, '燃料エネルギー 2.0L');
near(m('fuelMj').varieties['350mL'], 36815.50081027048, '燃料エネルギー 350mL');
assert.strictEqual(m('fuelMj').varieties['1.0L'], 0, '本数0の品種は0');
near(m('productionBottles').monthlyTotal, 9919599, '生産本数 月計 (品種別の合計)');
near(m('operationMin').monthlyTotal, 40574, '操業時間 月計');
near(m('mjPerBottle').monthlyTotal, 0.5447204065406273, '単位本燃料エネルギー 月計');
near(m('mjPerBottle').varieties['2.0L'], 0.9983404374651333, '単位本燃料エネルギー 2.0L');
assert.strictEqual(m('mjPerBottle').varieties['1.0L'], 0, '本数0の品種の原単位は0');
near(m('mjPerMinute').monthlyTotal, 7990.449056045743 / 60, '単位時間燃料エネルギー 月計');
near(m('mjPerMinute').varieties['2.0L'], 9681.488643366785 / 60, '単位時間燃料エネルギー 2.0L');
near(m('fuelCostYen').monthlyTotal, 11887430.796779998, '燃料コスト 月計');
near(m('fuelCostYen').varieties['2.0L'], 7852643.581142212, '燃料コスト 2.0L');
near(m('costPerBottle').monthlyTotal, 1.1983781599215853, '単位本コスト 月計');
near(m('costPerBottle').varieties['500mL角'], 0.5490841549441502, '単位本コスト 500mL角');
near(m('costPerMinute').monthlyTotal, 17578.889136067428 / 60, '単位時間コスト 月計');
near(m('costPerMinute').varieties['1.5L'], 19445.742460069876 / 60, '単位時間コスト 1.5L');
console.log('Allocation and metrics PASSED!');

console.log('=== Test 3: 累計と年間計 (原単位系は累計どうし・年間計どうしの比) ===');
const may = key => ds.metrics[key].months['202405'];
near(may('fuelMj').varieties['600mL丸'], 699431.2568781234, '2024年5月 燃料エネルギー 600mL丸');
near(may('productionBottles').cumulativeTotal, 21494661, '生産本数 累計');
near(may('operationMin').cumulativeTotal, 79567, '操業時間 累計');
near(may('fuelMj').cumulativeTotal, 10630729, '燃料エネルギー 累計');
near(may('fuelCostYen').cumulativeTotal, 21781503.11678, '燃料コスト 累計');
near(may('mjPerBottle').cumulativeTotal, 0.494575327333611, '単位本燃料エネルギー 累計');
near(may('mjPerMinute').cumulativeTotal, 8016.4357082710185 / 60, '単位時間燃料エネルギー 累計');
near(may('costPerBottle').cumulativeTotal, 1.013344807660842, '単位本コスト 累計');
near(may('costPerMinute').cumulativeTotal, 16425.02780055551 / 60, '単位時間コスト 累計');
// 年間計 (2か月分) は累計の最終月と同じ値になる
near(ds.metrics.fuelMj.annualTotal.monthlyTotal, 10630729, '燃料エネルギー 年間計');
near(ds.metrics.mjPerBottle.annualTotal.monthlyTotal, 0.494575327333611, '単位本燃料エネルギー 年間計');
near(ds.metrics.mjPerBottle.annualTotal.varieties['2.0L'], (3569403.5046652774 + 1855432.6695647996) / (3575337 + 1538138), '単位本燃料エネルギー 年間計 2.0L');
// データの無い月
const jun = ds.metrics.fuelMj.months['202406'];
assert.strictEqual(jun.hasData, false);
assert.strictEqual(jun.monthlyTotal, null);
assert.strictEqual(jun.cumulativeTotal, null);
assert.strictEqual(ds.breakdown['202406'].hasData, false);
near(ds.breakdown['202405'].unitPriceYenPerMj, 1.89276157328008, '燃料内訳 2024年5月の単価');
near(ds.breakdownTotal.totalGj, 357.88 + 5045.528 + 116.7 + 5110.621, '燃料内訳 年間の熱量');
console.log('Cumulative and annual totals PASSED!');

console.log('=== Test 4: 本数・操業時間が無い月 ===');
const partial = FuelService.buildFuelAnnualDataset(2024, {
  '202404': fuelMonthly['202404'],
  '202405': Object.assign({}, fuelMonthly['202405'], { bottles: null }) // 月報PETに年度のシートが無い場合
}, { '202404': operationMin['202404'] }); // 5月は電力側のデータ (操業時間) も無い
const p = key => partial.metrics[key].months['202405'];
assert.strictEqual(p('fuelMj').hasData, true, '燃料エネルギーの月計は表示できる');
near(p('fuelMj').monthlyTotal, 5227321, '本数が無くても月計は出る');
assert.strictEqual(p('fuelMj').varieties['2.0L'], null, '本数が無い月は品種別に按分できない');
assert.strictEqual(p('fuelCostYen').varieties['2.0L'], null);
assert.strictEqual(p('productionBottles').hasData, false);
assert.strictEqual(p('mjPerBottle').hasData, false);
assert.strictEqual(p('costPerBottle').hasData, false);
assert.strictEqual(p('operationMin').hasData, false);
assert.strictEqual(p('mjPerMinute').hasData, false);
assert.strictEqual(p('costPerMinute').hasData, false);
// 原単位系の年間計は、分子・分母ともデータのある月 (4月) だけで計算する
near(partial.metrics.mjPerBottle.annualTotal.monthlyTotal, 0.5447204065406273, '単位本の年間計は本数のある月だけ');
near(partial.metrics.mjPerMinute.annualTotal.monthlyTotal, 7990.449056045743 / 60, '単位時間の年間計は操業時間のある月だけ');
near(partial.metrics.fuelMj.annualTotal.monthlyTotal, 10630729, '総量の年間計は全月');

// 操業時間はあるが本数が無い月: 月計の単位時間は出るが、品種別は按分できないため null
const noBottles = FuelService.buildFuelAnnualDataset(2024, { '202404': Object.assign({}, fuelMonthly['202404'], { bottles: null }) }, operationMin);
assert.strictEqual(noBottles.metrics.mjPerMinute.months['202404'].hasData, true);
near(noBottles.metrics.mjPerMinute.months['202404'].monthlyTotal, 7990.449056045743 / 60, '月計の単位時間');
assert.strictEqual(noBottles.metrics.mjPerMinute.months['202404'].varieties['2.0L'], null);

// 全月データなし
const empty = FuelService.buildFuelAnnualDataset(2030, {}, {});
assert.strictEqual(empty.availableMonthsCount, 0);
assert.strictEqual(empty.breakdownTotal, null);
assert.strictEqual(empty.metrics.fuelMj.annualTotal.monthlyTotal, null);
console.log('Missing bottles / operation time PASSED!');

console.log('FUEL SERVICE VERIFIED SUCCESSFULLY!');
