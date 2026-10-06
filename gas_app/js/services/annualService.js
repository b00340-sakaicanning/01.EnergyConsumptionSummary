/**
 * gas_app/js/services/annualService.js
 * 年間（4月〜翌3月）月別・品種別集約＆評価サービス
 * 月別電力使用量集約グラフ表示(総電力 2024).xlsx の仕様に完全準拠
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const config = require('../config');
    module.exports = factory(config);
  } else {
    root.AnnualService = factory(root.AppConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (config) {

  const { VARIETY_GROUPS, EVALUATION_METRICS, OPERATION_MODES } = config;

  /**
   * 年間12ヶ月の年月リスト (4月〜翌年3月) を生成
   * @param {number} fiscalYear (例: 2024)
   * @returns {Array} ['202404', '202405', ..., '202503']
   */
  function getFiscalMonths(fiscalYear) {
    const months = [];
    for (let m = 4; m <= 12; m++) {
      months.push(`${fiscalYear}${String(m).padStart(2, '0')}`);
    }
    for (let m = 1; m <= 3; m++) {
      months.push(`${fiscalYear + 1}${String(m).padStart(2, '0')}`);
    }
    return months;
  }

  /**
   * 品種コード（tag02）から8大分類グループキーを特定
   * @param {number|string} code 
   * @returns {string|null} '2.0L', '500mL丸' 等
   */
  function matchVarietyGroup(code) {
    const c = parseInt(code, 10);
    for (const group of VARIETY_GROUPS) {
      if (group.codes.includes(c)) return group.key;
    }
    // コードが名称や部分一致の場合のフォールバック
    const name = config.VARIETY_MASTER[c] || '';
    if (name.includes('2L') || name.includes('２Ｌ')) return '2.0L';
    if (name.includes('1.5L')) return '1.5L';
    if (name.includes('1L') || name.includes('１Ｌ') || name.includes('900ml')) return '1.0L';
    if (name.includes('600ml') || name.includes('600mL')) return '600mL丸';
    if (name.includes('500ml 丸') || name.includes('500mL 丸')) return '500mL丸';
    if (name.includes('500ml 角') || name.includes('500mL 角') || name.includes('500ml 6角')) return '500mL角';
    if (name.includes('350ml') || name.includes('350mL')) return '350mL';
    if (name.includes('280ml') || name.includes('280mL')) return '280mL';
    return '500mL丸'; // デフォルトフォールバック
  }

  /**
   * 1ヶ月分の1時間集約データから品種×操業モード別集計を抽出
   * @param {Array} hourlyRows
   * @returns {Object} { combined: {...}, waterOnly: {...}, fillingOnly: {...} }
   */
  function aggregateMonthByVariety(hourlyRows) {
    const result = {
      combined: { powerKwh: {}, operationMin: {} },
      waterOnly: { powerKwh: {}, operationMin: {} },
      fillingOnly: { powerKwh: {}, operationMin: {} }
    };

    VARIETY_GROUPS.forEach(g => {
      ['combined', 'waterOnly', 'fillingOnly'].forEach(mode => {
        result[mode].powerKwh[g.key] = 0;
        result[mode].operationMin[g.key] = 0;
      });
    });

    for (const row of hourlyRows) {
      const vCode = row.varietyCode || 101;
      const vGroup = matchVarietyGroup(vCode);

      // 1時間行の総電力 (AppConfig.CATEGORY_COLUMN_MAP['total'] の各列合計)
      let totalKwh = 0;
      if (row.categories && row.categories['総電力'] !== undefined) {
        totalKwh = row.categories['総電力'];
      } else if (row.values) {
        const totalCols = config.CATEGORY_COLUMN_MAP ? config.CATEGORY_COLUMN_MAP['total'] : null;
        if (totalCols && totalCols.length > 0) {
          for (const col of totalCols) {
            const v = row.values[col];
            if (typeof v === 'number') totalKwh += v;
          }
        } else {
          for (const v of Object.values(row.values)) {
            if (typeof v === 'number') totalKwh += v;
          }
        }
      }
      totalKwh = Math.round(totalKwh * 10) / 10;

      const opTimes = row.operationTimes || {};
      const wMin = opTimes.waterTimeMin || 0;
      const fMin = opTimes.actualFillingMin || 0;
      const combMin = wMin + fMin;

      // 操業時間および電力量の配分
      if (combMin > 0) {
        result.combined.powerKwh[vGroup] = (result.combined.powerKwh[vGroup] || 0) + totalKwh;
        result.combined.operationMin[vGroup] = (result.combined.operationMin[vGroup] || 0) + combMin;
      }
      if (wMin > 0) {
        const wRatio = combMin > 0 ? (wMin / combMin) : 1;
        result.waterOnly.powerKwh[vGroup] = (result.waterOnly.powerKwh[vGroup] || 0) + Math.round(totalKwh * wRatio * 10) / 10;
        result.waterOnly.operationMin[vGroup] = (result.waterOnly.operationMin[vGroup] || 0) + wMin;
      }
      if (fMin > 0) {
        const fRatio = combMin > 0 ? (fMin / combMin) : 1;
        result.fillingOnly.powerKwh[vGroup] = (result.fillingOnly.powerKwh[vGroup] || 0) + Math.round(totalKwh * fRatio * 10) / 10;
        result.fillingOnly.operationMin[vGroup] = (result.fillingOnly.operationMin[vGroup] || 0) + fMin;
      }
    }

    // 四捨五入
    ['combined', 'waterOnly', 'fillingOnly'].forEach(m => {
      VARIETY_GROUPS.forEach(g => {
        result[m].powerKwh[g.key] = Math.round(result[m].powerKwh[g.key] * 10) / 10;
      });
    });

    return result;
  }

  /**
   * 年間データ構造の初期化
   * @param {number} fiscalYear
   */
  function createEmptyAnnualDataset(fiscalYear) {
    const months = getFiscalMonths(fiscalYear);
    const dataset = {
      fiscalYear,
      months, // ['202404', ... '202503']
      monthLabels: ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'],
      unitPrices: {}, // '202404': 19.36, etc.
      modes: {
        combined: createEmptyModeTable(months),
        waterOnly: createEmptyModeTable(months),
        fillingOnly: createEmptyModeTable(months)
      }
    };
    return dataset;
  }

  function createEmptyModeTable(months) {
    const table = {};
    EVALUATION_METRICS.forEach(metric => {
      table[metric.key] = {
        months: {},
        annualTotal: {
          monthlyTotal: 0,
          varieties: {}
        }
      };
      VARIETY_GROUPS.forEach(g => {
        table[metric.key].annualTotal.varieties[g.key] = 0;
      });

      months.forEach(ym => {
        table[metric.key].months[ym] = {
          yearMonth: ym,
          cumulativeTotal: 0,
          monthlyTotal: 0,
          varieties: {}
        };
        VARIETY_GROUPS.forEach(g => {
          table[metric.key].months[ym].varieties[g.key] = 0;
        });
      });
    });
    return table;
  }

  /**
   * 読み込み済み月別データセット群から年間データセットを構築する
   * 期中（例: 4月〜9月など一部月のみ投入）の場合でも、存在する月のみで推移・合計を正確に集約
   * @param {number|string} fiscalYear 例: 2024, 2026
   * @param {Object} monthlyDatasets { '202404': { ym, aggResult, catResult, kpiResult, externalData }, ... }
   * @returns {Object} annualData (Excel原紙仕様完全準拠)
   */
  function buildAnnualDataset(fiscalYear, monthlyDatasets = {}) {
    const fYear = parseInt(fiscalYear, 10);
    const months = getFiscalMonths(fYear);
    const monthLabels = ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'];

    const annualDataset = createEmptyAnnualDataset(fYear);
    annualDataset.fiscalYear = fYear;
    annualDataset.months = months;
    annualDataset.monthLabels = monthLabels;

    const unitPrices = {};
    const equipmentCats = [
      '総電力', 'ユーティリティ', 'コンプレッサー', 'ボイラー',
      '純水装置', '排水処理', 'チラー', '調合抽出', '供給', '充填', '包装'
    ];

    const equipmentSummary = {
      months: months,
      categories: {},
      operationTimes: {
        actualFillingHours: { monthly: new Array(12).fill(null), annualTotal: 0 },
        waterHours: { monthly: new Array(12).fill(null), annualTotal: 0 },
        totalHours: { monthly: new Array(12).fill(null), annualTotal: 0 }
      }
    };

    equipmentCats.forEach(cat => {
      equipmentSummary.categories[cat] = {
        monthly: new Array(12).fill(null),
        annualTotal: 0
      };
    });

    const availableMonths = [];

    // 1. 各月ごとのデータ抽出と集約
    months.forEach((ym, mIdx) => {
      const ds = monthlyDatasets[ym];
      if (!ds) {
        // データが存在しない月は hasData = false
        ['combined', 'waterOnly', 'fillingOnly'].forEach(mode => {
          EVALUATION_METRICS.forEach(metric => {
            const mData = annualDataset.modes[mode][metric.key].months[ym];
            mData.hasData = false;
            mData.monthlyTotal = null;
            VARIETY_GROUPS.forEach(g => {
              mData.varieties[g.key] = null;
            });
          });
        });
        return;
      }

      availableMonths.push(ym);

      const ext = ds.externalData || {};
      const ele = ext.electricity || {};
      const prod = ext.production || {};
      const unitPrice = ele.unitPriceYenPerKwh || 20.0;
      unitPrices[ym] = unitPrice;

      // 1-1. 設備別集約
      if (ds.catResult) {
        const catTotals = ds.catResult.categoryMonthlyTotals || {};
        equipmentCats.forEach(cat => {
          const val = catTotals[cat] ? (catTotals[cat].grandTotal || 0) : 0;
          equipmentSummary.categories[cat].monthly[mIdx] = Math.round(val * 10) / 10;
        });

        const opTimes = ds.catResult.monthlyOperationTimes || {};
        const fH = Math.round(((opTimes.actualFillingMin || 0) / 60) * 10) / 10;
        const wH = Math.round(((opTimes.waterTimeMin || 0) / 60) * 10) / 10;
        equipmentSummary.operationTimes.actualFillingHours.monthly[mIdx] = fH;
        equipmentSummary.operationTimes.waterHours.monthly[mIdx] = wH;
        equipmentSummary.operationTimes.totalHours.monthly[mIdx] = Math.round((fH + wH) * 10) / 10;
      }

      // 1-2. 品種別集約 (hourlyRows から品種別電力量・操業時間を算出、または保存済み varietyAgg を利用)
      let varietyAgg = null;
      if (ds.aggResult && ds.aggResult.rows) {
        varietyAgg = aggregateMonthByVariety(ds.aggResult.rows);
      } else if (ds.varietyAgg) {
        varietyAgg = ds.varietyAgg;
      } else {
        varietyAgg = {
          combined: { powerKwh: {}, operationMin: {} },
          waterOnly: { powerKwh: {}, operationMin: {} },
          fillingOnly: { powerKwh: {}, operationMin: {} }
        };
      }

      // 品種別生産本数
      const prodVarieties = prod.varieties || {};
      const totalBottles = prod.totalBottles || 0;

      // 1-3. 各操業モードへの反映
      ['combined', 'waterOnly', 'fillingOnly'].forEach(mode => {
        const modeTable = annualDataset.modes[mode];
        const vPower = (varietyAgg[mode] && varietyAgg[mode].powerKwh) || {};
        const vOpMin = (varietyAgg[mode] && varietyAgg[mode].operationMin) || {};

        let mPowerTotal = 0;
        let mMinTotal = 0;
        VARIETY_GROUPS.forEach(g => {
          mPowerTotal += (vPower[g.key] || 0);
          mMinTotal += (vOpMin[g.key] || 0);
        });

        // 生産本数（水運転のみは0）
        const mBottlesTotal = (mode === 'waterOnly') ? 0 : totalBottles;

        // フォールバック: 生データからの電力合計が0で、カテゴリ集計に総電力がある場合
        const catTotalPower = (ds.catResult && ds.catResult.categoryMonthlyTotals && ds.catResult.categoryMonthlyTotals['総電力'])
          ? (ds.catResult.categoryMonthlyTotals['総電力'].grandTotal || 0) : 0;
        const opTimes = (ds.catResult && ds.catResult.monthlyOperationTimes) || {};
        const catWaterMin = opTimes.waterTimeMin || 0;
        const catFillingMin = opTimes.actualFillingMin || 0;
        const catCombMin = catWaterMin + catFillingMin;

        if (mPowerTotal === 0 && catTotalPower > 0) {
          if (mode === 'combined') mPowerTotal = catTotalPower;
          else if (mode === 'waterOnly') mPowerTotal = catCombMin > 0 ? (catTotalPower * (catWaterMin / catCombMin)) : 0;
          else if (mode === 'fillingOnly') mPowerTotal = catCombMin > 0 ? (catTotalPower * (catFillingMin / catCombMin)) : catTotalPower;
          mPowerTotal = Math.round(mPowerTotal * 10) / 10;
        }

        if (mMinTotal === 0 && catCombMin > 0) {
          if (mode === 'combined') mMinTotal = catCombMin;
          else if (mode === 'waterOnly') mMinTotal = catWaterMin;
          else if (mode === 'fillingOnly') mMinTotal = catFillingMin;
        }

        // もし各品種の電力が全て0で、月報PETの品種別本数がある場合は本数比率で按分
        const vPowerSum = VARIETY_GROUPS.reduce((acc, g) => acc + (vPower[g.key] || 0), 0);
        if (vPowerSum === 0 && mPowerTotal > 0 && totalBottles > 0) {
          VARIETY_GROUPS.forEach(g => {
            const b = prodVarieties[g.key] || 0;
            vPower[g.key] = b > 0 ? Math.round((mPowerTotal * (b / totalBottles)) * 10) / 10 : 0;
          });
        }
        const vMinSum = VARIETY_GROUPS.reduce((acc, g) => acc + (vOpMin[g.key] || 0), 0);
        if (vMinSum === 0 && mMinTotal > 0 && totalBottles > 0) {
          VARIETY_GROUPS.forEach(g => {
            const b = prodVarieties[g.key] || 0;
            vOpMin[g.key] = b > 0 ? Math.round(mMinTotal * (b / totalBottles)) : 0;
          });
        }

        // powerKwh
        const pkObj = modeTable.powerKwh.months[ym];
        pkObj.hasData = true;
        pkObj.monthlyTotal = Math.round(mPowerTotal * 10) / 10;
        VARIETY_GROUPS.forEach(g => {
          pkObj.varieties[g.key] = Math.round((vPower[g.key] || 0) * 10) / 10;
        });

        // operationMin
        const omObj = modeTable.operationMin.months[ym];
        omObj.hasData = true;
        omObj.monthlyTotal = Math.round(mMinTotal);
        VARIETY_GROUPS.forEach(g => {
          omObj.varieties[g.key] = Math.round(vOpMin[g.key] || 0);
        });

        // productionBottles
        const pbObj = modeTable.productionBottles.months[ym];
        pbObj.hasData = true;
        pbObj.monthlyTotal = mBottlesTotal;
        const hasProdVarieties = Object.keys(prodVarieties).length > 0;
        VARIETY_GROUPS.forEach(g => {
          let bCount = (mode === 'waterOnly') ? 0 : (prodVarieties[g.key] || 0);
          if (!hasProdVarieties && bCount === 0 && mBottlesTotal > 0 && mMinTotal > 0 && (vOpMin[g.key] || 0) > 0) {
            bCount = Math.round(mBottlesTotal * ((vOpMin[g.key] || 0) / mMinTotal));
          }
          pbObj.varieties[g.key] = bCount;
        });

        // 原単位・コスト等の派生指標
        const totalCost = Math.round(mPowerTotal * unitPrice);

        const pcObj = modeTable.powerCostYen.months[ym];
        pcObj.hasData = true;
        pcObj.monthlyTotal = totalCost;

        const kbObj = modeTable.kwhPerBottle.months[ym];
        kbObj.hasData = true;
        kbObj.monthlyTotal = mBottlesTotal > 0 ? Math.round((mPowerTotal / mBottlesTotal) * 10000) / 10000 : 0;

        const kmObj = modeTable.kwhPerMinute.months[ym];
        kmObj.hasData = true;
        kmObj.monthlyTotal = mMinTotal > 0 ? Math.round((mPowerTotal / mMinTotal) * 1000) / 1000 : 0;

        const cbObj = modeTable.costPerBottle.months[ym];
        cbObj.hasData = true;
        cbObj.monthlyTotal = mBottlesTotal > 0 ? Math.round((totalCost / mBottlesTotal) * 100) / 100 : 0;

        const cmObj = modeTable.costPerMinute.months[ym];
        cmObj.hasData = true;
        cmObj.monthlyTotal = mMinTotal > 0 ? Math.round((totalCost / mMinTotal) * 100) / 100 : 0;

        VARIETY_GROUPS.forEach(g => {
          const pk = pkObj.varieties[g.key];
          const om = omObj.varieties[g.key];
          const pb = pbObj.varieties[g.key];
          const cost = Math.round(pk * unitPrice);

          pcObj.varieties[g.key] = cost;
          kbObj.varieties[g.key] = pb > 0 ? Math.round((pk / pb) * 10000) / 10000 : 0;
          kmObj.varieties[g.key] = om > 0 ? Math.round((pk / om) * 1000) / 1000 : 0;
          cbObj.varieties[g.key] = pb > 0 ? Math.round((cost / pb) * 100) / 100 : 0;
          cmObj.varieties[g.key] = om > 0 ? Math.round((cost / om) * 100) / 100 : 0;
        });
      });
    });

    // 2. 累積値 (cumulativeTotal) と年間合計 (annualTotal) の集計（存在する月のみ）
    equipmentCats.forEach(cat => {
      const sum = equipmentSummary.categories[cat].monthly
        .filter(v => v !== null)
        .reduce((a, b) => a + b, 0);
      equipmentSummary.categories[cat].annualTotal = Math.round(sum * 10) / 10;
    });

    ['actualFillingHours', 'waterHours', 'totalHours'].forEach(k => {
      const sum = equipmentSummary.operationTimes[k].monthly
        .filter(v => v !== null)
        .reduce((a, b) => a + b, 0);
      equipmentSummary.operationTimes[k].annualTotal = Math.round(sum * 10) / 10;
    });

    ['combined', 'waterOnly', 'fillingOnly'].forEach(mode => {
      const modeTable = annualDataset.modes[mode];
      EVALUATION_METRICS.forEach(metric => {
        const mKey = metric.key;
        const target = modeTable[mKey];
        if (!target) return;

        let cumMonthly = 0;
        let cumVarieties = {};
        VARIETY_GROUPS.forEach(g => { cumVarieties[g.key] = 0; });

        months.forEach(ym => {
          const mData = target.months[ym];
          if (mData.hasData) {
            cumMonthly += (mData.monthlyTotal || 0);
            mData.cumulativeTotal = (mKey.includes('Per') || mKey.includes('CostPer') || mKey.includes('kwhPer'))
              ? mData.monthlyTotal // 単価・比率系は月次値
              : Math.round(cumMonthly * 10) / 10;

            VARIETY_GROUPS.forEach(g => {
              cumVarieties[g.key] += (mData.varieties[g.key] || 0);
            });
          } else {
            mData.cumulativeTotal = null;
          }
        });

        // 年間実績合計 (annualTotal)
        target.annualTotal.monthlyTotal = Math.round(cumMonthly * 10) / 10;
        VARIETY_GROUPS.forEach(g => {
          target.annualTotal.varieties[g.key] = Math.round(cumVarieties[g.key] * 10) / 10;
        });

        // 原単位・比率系の年間合計値再計算（全社累計または平均）
        if (mKey === 'kwhPerBottle') {
          const totP = modeTable.powerKwh.annualTotal.monthlyTotal;
          const totB = modeTable.productionBottles.annualTotal.monthlyTotal;
          target.annualTotal.monthlyTotal = totB > 0 ? Math.round((totP / totB) * 10000) / 10000 : 0;
          VARIETY_GROUPS.forEach(g => {
            const vp = modeTable.powerKwh.annualTotal.varieties[g.key];
            const vb = modeTable.productionBottles.annualTotal.varieties[g.key];
            target.annualTotal.varieties[g.key] = vb > 0 ? Math.round((vp / vb) * 10000) / 10000 : 0;
          });
        } else if (mKey === 'kwhPerMinute') {
          const totP = modeTable.powerKwh.annualTotal.monthlyTotal;
          const totM = modeTable.operationMin.annualTotal.monthlyTotal;
          target.annualTotal.monthlyTotal = totM > 0 ? Math.round((totP / totM) * 1000) / 1000 : 0;
          VARIETY_GROUPS.forEach(g => {
            const vp = modeTable.powerKwh.annualTotal.varieties[g.key];
            const vm = modeTable.operationMin.annualTotal.varieties[g.key];
            target.annualTotal.varieties[g.key] = vm > 0 ? Math.round((vp / vm) * 1000) / 1000 : 0;
          });
        } else if (mKey === 'costPerBottle') {
          const totC = modeTable.powerCostYen.annualTotal.monthlyTotal;
          const totB = modeTable.productionBottles.annualTotal.monthlyTotal;
          target.annualTotal.monthlyTotal = totB > 0 ? Math.round((totC / totB) * 100) / 100 : 0;
          VARIETY_GROUPS.forEach(g => {
            const vc = modeTable.powerCostYen.annualTotal.varieties[g.key];
            const vb = modeTable.productionBottles.annualTotal.varieties[g.key];
            target.annualTotal.varieties[g.key] = vb > 0 ? Math.round((vc / vb) * 100) / 100 : 0;
          });
        } else if (mKey === 'costPerMinute') {
          const totC = modeTable.powerCostYen.annualTotal.monthlyTotal;
          const totM = modeTable.operationMin.annualTotal.monthlyTotal;
          target.annualTotal.monthlyTotal = totM > 0 ? Math.round((totC / totM) * 100) / 100 : 0;
          VARIETY_GROUPS.forEach(g => {
            const vc = modeTable.powerCostYen.annualTotal.varieties[g.key];
            const vm = modeTable.operationMin.annualTotal.varieties[g.key];
            target.annualTotal.varieties[g.key] = vm > 0 ? Math.round((vc / vm) * 100) / 100 : 0;
          });
        }
      });
    });

    annualDataset.unitPrices = unitPrices;
    annualDataset.equipmentSummary = equipmentSummary;
    annualDataset.availableMonths = availableMonths;
    annualDataset.availableMonthsCount = availableMonths.length;

    return annualDataset;
  }

  return {
    getFiscalMonths,
    matchVarietyGroup,
    aggregateMonthByVariety,
    createEmptyAnnualDataset,
    buildAnnualDataset
  };

}));
