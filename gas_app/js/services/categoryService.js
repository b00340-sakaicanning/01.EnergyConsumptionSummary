/**
 * gas_app/js/services/categoryService.js
 * 工程別小計および稼働モード別集計サービス
 * ブラウザ環境およびNode.js環境両対応
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppConfig = require('../config.js');
    module.exports = factory(AppConfig);
  } else {
    root.CategoryService = factory(root.AppConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (AppConfig) {

  /**
   * 1時間集約データから工程別小計を算出する
   * @param {Array<Object>} hourlyRows 1時間ごとの行データ
   * @param {Object} monthlyColumnSums 各列の月間合計
   * @returns {Object} { categoryDailyTotals, categoryMonthlyTotals, monthlyOperationTimes }
   */
  function aggregateCategories(hourlyRows, monthlyColumnSums = {}) {
    const categories = AppConfig.CATEGORIES; // [{ key, name, sheetName }]
    const colMap = AppConfig.CATEGORY_COLUMN_MAP;

    // 1. 各1時間行のカテゴリ小計を算出
    const categoryHourlyRows = hourlyRows.map(row => {
      const catSums = {};
      for (const cat of categories) {
        const cols = colMap[cat.key] || [];
        let sum = 0.0;
        for (const col of cols) {
          const v = row.values[col];
          if (typeof v === 'number') {
            sum += v;
          }
        }
        catSums[cat.name] = Math.round(sum * 10) / 10;
      }

      return {
        hourIndex: row.hourIndex,
        date: row.date,
        hour: row.hour,
        timestampKey: row.timestampKey,
        isInterpolated: row.isInterpolated,
        categories: catSums,
        operationTimes: row.operationTimes
      };
    });

    // 2. 日別集約 (24時間合計)
    const dailyMap = new Map();
    for (const row of categoryHourlyRows) {
      if (!dailyMap.has(row.date)) {
        const initialSums = {};
        for (const cat of categories) {
          initialSums[cat.name] = 0.0;
        }
        dailyMap.set(row.date, {
          date: row.date,
          day: parseInt(row.date.split('/')[2], 10),
          categories: initialSums,
          operationTimes: {
            waterTimeMin: 0,
            actualFillingMin: 0
          }
        });
      }

      const dayObj = dailyMap.get(row.date);
      for (const cat of categories) {
        dayObj.categories[cat.name] += (row.categories[cat.name] || 0);
      }

      if (row.operationTimes) {
        dayObj.operationTimes.waterTimeMin += (row.operationTimes.waterTimeMin || 0);
        dayObj.operationTimes.actualFillingMin += (row.operationTimes.actualFillingMin || 0);
      }
    }

    const categoryDailyTotals = Array.from(dailyMap.values()).map(d => {
      const roundedCats = {};
      for (const [k, v] of Object.entries(d.categories)) {
        roundedCats[k] = Math.round(v * 10) / 10;
      }
      return {
        date: d.date,
        day: d.day,
        categories: roundedCats,
        operationTimes: d.operationTimes
      };
    });

    // 3. 月間合計
    const categoryMonthlyTotals = {};
    for (const cat of categories) {
      const cols = colMap[cat.key] || [];
      let grandTotal = 0.0;
      const columnTotals = {};

      for (const col of cols) {
        const cSum = monthlyColumnSums[col] !== undefined ? monthlyColumnSums[col] : 0.0;
        columnTotals[col] = cSum;
        grandTotal += cSum;
      }

      categoryMonthlyTotals[cat.name] = {
        key: cat.key,
        name: cat.name,
        sheetName: cat.sheetName,
        grandTotal: Math.round(grandTotal * 10) / 10,
        columnTotals
      };
    }

    // 月間稼働時間合計
    const monthlyOperationTimes = {
      waterTimeMin: 0,
      actualFillingMin: 0
    };
    for (const d of categoryDailyTotals) {
      monthlyOperationTimes.waterTimeMin += d.operationTimes.waterTimeMin;
      monthlyOperationTimes.actualFillingMin += d.operationTimes.actualFillingMin;
    }

    return {
      categoryDailyTotals,
      categoryMonthlyTotals,
      monthlyOperationTimes
    };
  }

  return {
    aggregateCategories
  };
}));
