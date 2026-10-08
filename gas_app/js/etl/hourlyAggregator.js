/**
 * gas_app/js/etl/hourlyAggregator.js
 * 2段階欠損補正および1時間平均化集計モジュール
 * ブラウザ環境およびNode.js環境両対応
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppConfig = require('../config.js');
    module.exports = factory(AppConfig);
  } else {
    root.HourlyAggregator = factory(root.AppConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (AppConfig) {

  /**
   * 1分値レコード群を1時間単位（60分）に集約する
   * ロガーの仕様に基づき、各時間ブロックは「XX:01:00 〜 (XX+1):00:00」の60分間とする。
   * 例: Hour 0 は 00:01:00 〜 01:00:00、Hour 23 は 23:01:00 〜 翌00:00:00
   * @param {Map<string, Object>} mergedRecords タイムスタンプ -> 1分値オブジェクト
   * @param {string} yearMonth 'YYYYMM' (例: '202503')
   * @returns {Object} { hourlyRows: Array, monthlySummary: Object, columnKeys: Array }
   */
  function aggregateHourly(mergedRecords, yearMonth) {
    const year = parseInt(yearMonth.slice(0, 4), 10);
    const month = parseInt(yearMonth.slice(4, 6), 10);
    const daysInMonth = new Date(year, month, 0).getDate(); // 28, 29, 30, or 31
    const totalHours = daysInMonth * 24;

    const columnKeys = AppConfig.EQUIPMENT_COLUMNS.map(eq => eq.col);
    const fixedCols = {};
    for (const eq of AppConfig.EQUIPMENT_COLUMNS) {
      if (eq.fixedVal !== undefined) {
        fixedCols[eq.col] = eq.fixedVal;
      }
    }

    // 1時間ごとのバケットを初期化 (hourIndex: 0 から totalHours - 1)
    const hourBuckets = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
      for (let h = 0; h < 24; h++) {
        const hourStr = String(h).padStart(2, '0');
        const hourKey = `${dayStr} ${hourStr}:00`;
        hourBuckets.push({
          hourIndex: (day - 1) * 24 + h,
          day,
          hour: h,
          dateStr: dayStr,
          hourStr,
          timestampKey: hourKey,
          minuteRecords: [] // この1時間内に存在する1分値
        });
      }
    }

    // タイムスタンプごとに該当する1時間バケットへ振り分け
    // ルール:
    // 時刻 HH:MM:SS において、
    // MM:SS が 00:01 〜 01:00 は h=0
    // ...
    // MM:SS が 00:00:00 の場合は、前の日の 23時台 (Hour 23) に属する
    for (const [ts, record] of mergedRecords.entries()) {
      const parts = ts.split(' ');
      if (parts.length < 2) continue;
      const datePart = parts[0];
      const timePart = parts[1];
      const dMatch = datePart.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      if (!dMatch) continue;

      let rYear = parseInt(dMatch[1], 10);
      let rMonth = parseInt(dMatch[2], 10);
      let rDay = parseInt(dMatch[3], 10);

      const tParts = timePart.split(':');
      let tHour = parseInt(tParts[0], 10);
      let tMin = parseInt(tParts[1], 10);
      let tSec = parseInt(tParts[2] || '0', 10);

      if (isNaN(tHour) || isNaN(tMin)) continue;

      let bucketDay = rDay;
      let bucketHour = tHour;

      if (tMin === 0 && tSec === 0) {
        // 00:00:00 は前の時間の終了（例: 01:00:00 は Hour 0 の終了、00:00:00 は前日の Hour 23 の終了）
        if (tHour === 0) {
          // 前日 23時台
          bucketDay = rDay - 1;
          bucketHour = 23;
        } else {
          bucketHour = tHour - 1;
        }
      } else {
        // 00:01 〜 00:59 は Hour 0
        bucketHour = tHour;
      }

      if (rYear === year && rMonth === month && bucketDay >= 1 && bucketDay <= daysInMonth) {
        const hourIndex = (bucketDay - 1) * 24 + bucketHour;
        if (hourIndex >= 0 && hourIndex < hourBuckets.length) {
          hourBuckets[hourIndex].minuteRecords.push(record);
        }
      }
    }

    // 月末最終日 23時台の処理:
    // 生CSVが 23:59:00 で終了している場合、Excel仕様に基づき 23:59 の至近レコードを 24:00 (60分目) として補間
    const lastBucket = hourBuckets[hourBuckets.length - 1];
    if (lastBucket && lastBucket.minuteRecords.length === 59) {
      const lastRec = lastBucket.minuteRecords[lastBucket.minuteRecords.length - 1];
      if (lastRec) {
        lastBucket.minuteRecords.push(Object.assign({}, lastRec));
      }
    }

    // 2段階欠損補正＆平均値算出
    let lastValidHourlyValues = {};
    const hourlyRows = [];


    for (let i = 0; i < hourBuckets.length; i++) {
      const bucket = hourBuckets[i];
      const count = bucket.minuteRecords.length;
      const isMissingEntireHour = (count === 0);

      const rowValues = {};
      let isInterpolated = false;

      // 稼働モード分数のカウントおよび最頻品種コードの特定
      let waterTimeMin = 0;
      let actualFillingMin = 0;

      const varietyCounts = {};
      for (const rec of bucket.minuteRecords) {
        const stepVal = rec['step'];
        if (stepVal !== undefined && stepVal !== null) {
          const stepInfo = AppConfig.STEP_MASTER[stepVal];
          const catCode = stepInfo ? stepInfo.code : 0;
          if (catCode === 20) waterTimeMin++;
          else if (catCode === 30) actualFillingMin++;
        }

        const vVal = rec['variety'];
        if (vVal !== undefined && vVal !== null && vVal > 0) {
          varietyCounts[vVal] = (varietyCounts[vVal] || 0) + 1;
        }
      }

      let dominantVariety = null;
      let maxVCount = 0;
      for (const [v, c] of Object.entries(varietyCounts)) {
        if (c > maxVCount) {
          maxVCount = c;
          dominantVariety = parseInt(v, 10);
        }
      }

      // 各電力列の計算
      for (const col of columnKeys) {
        if (fixedCols[col] !== undefined) {
          rowValues[col] = fixedCols[col];
          continue;
        }

        if (isMissingEntireHour) {
          // 【パターン2】1時間以上の欠損: 至近データ補間
          if (lastValidHourlyValues[col] !== undefined) {
            rowValues[col] = lastValidHourlyValues[col];
            isInterpolated = true;
          } else {
            rowValues[col] = 0.0;
          }
        } else {
          // 【パターン1】1時間以内の欠損: 実測値のみで平均
          let sum = 0.0;
          let validCount = 0;
          for (const rec of bucket.minuteRecords) {
            const v = rec[col];
            if (v !== null && v !== undefined && !isNaN(v)) {
              sum += v;
              validCount++;
            }
          }

          if (validCount > 0) {
            const avg = Math.round((sum / validCount) * 10) / 10;
            rowValues[col] = avg;
          } else {
            rowValues[col] = lastValidHourlyValues[col] !== undefined ? lastValidHourlyValues[col] : 0.0;
          }
        }
      }

      if (!isMissingEntireHour) {
        lastValidHourlyValues = Object.assign({}, rowValues);
      }

      hourlyRows.push({
        hourIndex: bucket.hourIndex,
        timestampKey: bucket.timestampKey,
        date: bucket.dateStr,
        hour: bucket.hour,
        isInterpolated,
        varietyCode: dominantVariety,
        values: rowValues,
        operationTimes: {
          waterTimeMin,
          actualFillingMin
        }
      });
    }

    // 月間合計
    const monthlyColumnSums = {};
    for (const col of columnKeys) {
      let sum = 0.0;
      for (const row of hourlyRows) {
        const v = row.values[col];
        if (typeof v === 'number') {
          sum += v;
        }
      }
      monthlyColumnSums[col] = Math.round(sum * 10) / 10;
    }

    return {
      yearMonth,
      totalHours: hourlyRows.length,
      columnKeys,
      rows: hourlyRows,
      monthlyColumnSums
    };
  }

  return {
    aggregateHourly
  };
}));
