/**
 * tests/verify_variety_and_restore.js
 * スプレッドシート日付セル正規化および品種別集約・復元シミュレーションテスト
 */

const assert = require('assert');

// 1. formatDateCell テスト
function formatDateCell(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    var y = val.getFullYear();
    var m = ('0' + (val.getMonth() + 1)).slice(-2);
    var d = ('0' + val.getDate()).slice(-2);
    return y + '/' + m + '/' + d;
  }
  var s = String(val).trim();
  var parts = s.split(/[\/\-]/);
  if (parts.length === 3 && parts[0].length === 4) {
    var y = parts[0];
    var m = ('0' + parts[1]).slice(-2);
    var d = ('0' + parts[2].slice(0, 2)).slice(-2);
    return y + '/' + m + '/' + d;
  }
  return s;
}

console.log('--- Test 1: formatDateCell ---');
const dateObj = new Date(2024, 3, 1); // 2024/04/01
assert.strictEqual(formatDateCell(dateObj), '2024/04/01');
assert.strictEqual(formatDateCell('2024/4/1'), '2024/04/01');
assert.strictEqual(formatDateCell('2024-04-01'), '2024/04/01');
console.log('formatDateCell passed successfully!');

// 2. annualService との結合テスト
const config = require('../gas_app/js/config');
const annualServiceFactory = require('../gas_app/js/services/annualService');
const annualService = annualServiceFactory;

console.log('--- Test 2: buildAnnualDataset with restored dataset ---');

const mockRestoredMonthlySummary = {
  '202404': {
    ym: '202404',
    catResult: {
      categoryMonthlyTotals: {
        '総電力': { grandTotal: 250000.5 },
        'ユーティリティ': { grandTotal: 15000.0 },
        '充填': { grandTotal: 30000.0 }
      },
      monthlyOperationTimes: { waterTimeMin: 1200, actualFillingMin: 18000 }
    },
    kpiResult: {
      electricitySummary: { unitPriceYenPerKwh: 20.5 },
      evaluation: {
        combined: {
          totalKwh: 250000.5,
          operationTimeMin: 19200,
          productionBottles: 5000000
        }
      }
    },
    externalData: {
      production: {
        totalBottles: 5000000,
        varieties: {
          '500mL丸': 3000000,
          '2.0L': 2000000
        }
      },
      electricity: { unitPriceYenPerKwh: 20.5 }
    },
    varietyAgg: {
      combined: {
        powerKwh: { '500mL丸': 150000.0, '2.0L': 100000.5 },
        operationMin: { '500mL丸': 11520, '2.0L': 7680 }
      },
      waterOnly: { powerKwh: {}, operationMin: {} },
      fillingOnly: {
        powerKwh: { '500mL丸': 150000.0, '2.0L': 100000.5 },
        operationMin: { '500mL丸': 11520, '2.0L': 7680 }
      }
    }
  },
  '202405': {
    ym: '202405',
    catResult: {
      categoryMonthlyTotals: {
        '総電力': { grandTotal: 280000.0 },
        'ユーティリティ': { grandTotal: 16000.0 },
        '充填': { grandTotal: 32000.0 }
      },
      monthlyOperationTimes: { waterTimeMin: 1000, actualFillingMin: 20000 }
    },
    kpiResult: {
      electricitySummary: { unitPriceYenPerKwh: 20.5 },
      evaluation: {
        combined: {
          totalKwh: 280000.0,
          operationTimeMin: 21000,
          productionBottles: 5500000
        }
      }
    },
    externalData: {
      production: {
        totalBottles: 5500000,
        varieties: {
          '500mL丸': 3500000,
          '2.0L': 2000000
        }
      },
      electricity: { unitPriceYenPerKwh: 20.5 }
    },
    varietyAgg: {
      combined: {
        powerKwh: { '500mL丸': 178181.8, '2.0L': 101818.2 },
        operationMin: { '500mL丸': 13363, '2.0L': 7637 }
      },
      waterOnly: { powerKwh: {}, operationMin: {} },
      fillingOnly: {
        powerKwh: { '500mL丸': 178181.8, '2.0L': 101818.2 },
        operationMin: { '500mL丸': 13363, '2.0L': 7637 }
      }
    }
  }
};

const annualData = annualService.buildAnnualDataset(2024, mockRestoredMonthlySummary);

// 検証 1: 設備別分析
console.log('Equipment Total 202404:', annualData.equipmentSummary.categories['総電力'].monthly[0]);
assert.strictEqual(annualData.equipmentSummary.categories['総電力'].monthly[0], 250000.5);
assert.strictEqual(annualData.equipmentSummary.categories['総電力'].monthly[1], 280000.0);

// 検証 2: 品種別分析 (500mL丸 の電力量)
const v500Power04 = annualData.modes.combined.powerKwh.months['202404'].varieties['500mL丸'];
console.log('500mL丸 Combined Power 202404:', v500Power04);
assert.strictEqual(v500Power04, 150000.0);

// 検証 3: 品種別生産本数
const v500Bottles04 = annualData.modes.combined.productionBottles.months['202404'].varieties['500mL丸'];
console.log('500mL丸 Combined Bottles 202404:', v500Bottles04);
assert.strictEqual(v500Bottles04, 3000000);

// 検証 4: 年間累積生産本数
console.log('Annual Total Bottles:', annualData.modes.combined.productionBottles.annualTotal.monthlyTotal);
assert.strictEqual(annualData.modes.combined.productionBottles.annualTotal.monthlyTotal, 10500000);

console.log('ALL RESTORATION TESTS PASSED PERFECTLY!');
