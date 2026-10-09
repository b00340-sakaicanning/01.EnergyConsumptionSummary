/**
 * gas_app/Code.gs
 * エネルギー使用量集計システム GASバックエンド (doGet / スプレッドシートへの保存・復元・エクスポート用データ取得)
 * 電力: saveAggregatedData / loadSavedSummaryFromSpreadsheet
 * 燃料エネルギー: saveFuelMonthlyData / loadSavedFuelData
 * トータルエネルギー: saveTotalEnergyMonthlyData / loadSavedTotalEnergyData
 * 共通: getSheetsDataForExport
 */

/**
 * Webアプリケーションのエントリポイント (GET)
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('エネルギー使用量集計システム')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * スプレッドシートセルの日付値を 'YYYY/MM/DD' 文字列に正規化
 * Date オブジェクト、ISO文字列、スラッシュ・ハイフン区切りのいずれにも対応
 */
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

/**
 * 集約データをスプレッドシートへ書き込む (一括ブロック書き込み・超高速Upsert対応)
 */
function saveAggregatedData(payload) {
  var ss = getSpreadsheet();
  if (!ss) {
    throw new Error('スプレッドシートが見つかりません。Config.gs の SPREADSHEET_ID を確認してください。');
  }
  setupSheets(ss);

  var hourlyRows = payload.rows || [];
  var yearMonth = payload.yearMonth || '';
  var categoryDailyTotals = payload.categoryDailyTotals || [];
  var kpi = payload.kpi || {};
  var varietyData = payload.varietyData || null;

  var updatedCount = 0;
  var appendedCount = 0;

  // 1. 「1時間集計(ALL)」への一括ブロック書き込み
  if (hourlyRows.length > 0) {
    var sheetHourly = ss.getSheetByName(CONFIG.SHEET_NAMES.HOURLY);
    var cols = CONFIG.COLUMNS; // 90列

    // 全行を2次元配列に構築
    var allBlockRows = [];
    for (var i = 0; i < hourlyRows.length; i++) {
      var hRow = hourlyRows[i];
      var tsKey = hRow.timestampKey || (hRow.date + ' ' + String(hRow.hour).padStart(2, '0') + ':00');

      var rowValues = [tsKey, hRow.date, hRow.hour];
      for (var c = 0; c < cols.length; c++) {
        var colLetter = cols[c].col;
        var val = hRow.values ? hRow.values[colLetter] : null;
        rowValues.push(val !== undefined && val !== null ? val : 0.0);
      }

      // 補間フラグ・稼働時間
      var isInterp = hRow.isInterpolated ? '補間' : '';
      var waterMin = hRow.operationTimes ? (hRow.operationTimes.waterTimeMin || 0) : 0;
      var fillMin = hRow.operationTimes ? (hRow.operationTimes.actualFillingMin || 0) : 0;
      rowValues.push(isInterp, waterMin, fillMin);

      allBlockRows.push(rowValues);
    }

    if (writeMonthBlock(sheetHourly, allBlockRows, yearMonth)) {
      updatedCount = allBlockRows.length;
    } else {
      appendedCount = allBlockRows.length;
    }
  }

  // 2. 「日別集約」へのUpsert書き込み
  if (categoryDailyTotals.length > 0) {
    saveDailySummary(ss, categoryDailyTotals, yearMonth);
  }

  // 3. 「KPI評価」へのUpsert書き込み
  if (kpi && kpi.evaluation) {
    saveKpiSummary(ss, yearMonth, kpi);
  }

  // 4. 「品種別集約」へのUpsert書き込み
  if (varietyData) {
    saveVarietySummary(ss, yearMonth, varietyData);
  }

  SpreadsheetApp.flush();

  return {
    success: true,
    yearMonth: yearMonth,
    totalReceivedHours: hourlyRows.length,
    updatedCount: updatedCount,
    appendedCount: appendedCount
  };
}

/**
 * 日別集約シートへの書き込み (日付キーによる一括ブロックUpsert対応)
 */
function saveDailySummary(ss, dailyTotals, yearMonth) {
  var sheetDaily = ss.getSheetByName(CONFIG.SHEET_NAMES.DAILY);
  var categories = CONFIG.CATEGORIES;

  var outputRows = [];
  for (var i = 0; i < dailyTotals.length; i++) {
    var d = dailyTotals[i];
    var row = [d.date, d.day];
    for (var c = 0; c < categories.length; c++) {
      var catName = categories[c].name;
      row.push(d.categories ? (d.categories[catName] || 0) : 0);
    }
    if (d.operationTimes) {
      row.push(
        d.operationTimes.waterTimeMin || 0,
        d.operationTimes.actualFillingMin || 0,
        (d.operationTimes.waterTimeMin || 0) + (d.operationTimes.actualFillingMin || 0)
      );
    }
    outputRows.push(row);
  }

  if (outputRows.length === 0) return;

  writeMonthBlock(sheetDaily, outputRows, yearMonth);
}

/**
 * 月ブロック (同じ年月の行のまとまり) をシートへ一括で書き込む
 * A列が対象年月で始まる最初の行があればその位置から上書きし、無ければ末尾へ追記する
 * (API呼び出し1回で1か月分を更新する。同じ月の行が連続し、行数が変わらないことが前提)
 * @param {Sheet} sheet 書き込み先シート (1行目はヘッダー)
 * @param {Array<Array>} rows 書き込む行データ (1行以上)
 * @param {string} yearMonth 'YYYYMM'
 * @returns {boolean} 既存月を上書きした場合は true、末尾へ追記した場合は false
 */
function writeMonthBlock(sheet, rows, yearMonth) {
  var lastRow = sheet.getLastRow();
  var ymPrefix = '';
  if (yearMonth && yearMonth.length === 6) {
    ymPrefix = yearMonth.slice(0, 4) + '/' + yearMonth.slice(4, 6) + '/';
  }

  var existingStartRow = -1;
  if (lastRow >= 2) {
    var dateValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var r = 0; r < dateValues.length; r++) {
      var cellVal = formatDateCell(dateValues[r][0]);
      if (ymPrefix && cellVal.indexOf(ymPrefix) === 0) {
        existingStartRow = r + 2;
        break;
      }
    }
  }

  // ヘッダーが1行目のため、追記時の最小開始行は2
  var targetRow = existingStartRow > 0 ? existingStartRow : Math.max(lastRow + 1, 2);
  sheet.getRange(targetRow, 1, rows.length, rows[0].length).setValues(rows);
  return existingStartRow > 0;
}

/**
 * 対象年月をキーに1行を書き込む (A列が一致する行があれば上書き、無ければ末尾へ追記)
 * @param {Sheet} sheet 書き込み先シート (1行目はヘッダー、A列が対象年月)
 * @param {string} yearMonth 'YYYYMM'
 * @param {Array} newRow 書き込む1行分のデータ
 */
function upsertRowByYearMonth(sheet, yearMonth, newRow) {
  var lastRow = sheet.getLastRow();
  var targetRow = -1;
  if (lastRow >= 2) {
    var ymValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var r = 0; r < ymValues.length; r++) {
      if (String(ymValues[r][0] || '').trim() === String(yearMonth).trim()) {
        targetRow = r + 2;
        break;
      }
    }
  }

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, newRow.length).setValues([newRow]);
  } else {
    sheet.appendRow(newRow);
  }
}

/**
 * 品種別集約シートへの書き込み (実充填・水運転の各操業モード分離保存・Upsert対応)
 */
function saveVarietySummary(ss, yearMonth, varietyData) {
  if (!yearMonth) return;
  var sheetVariety = ss.getSheetByName(CONFIG.SHEET_NAMES.VARIETY);
  if (!sheetVariety) return;

  var keys = CONFIG.VARIETY_KEYS;
  var bottles = (varietyData && varietyData.bottles) || {};
  var fKwh = (varietyData && (varietyData.fillingPowerKwh || varietyData.powerKwh)) || {};
  var wKwh = (varietyData && varietyData.waterPowerKwh) || {};
  var fMins = (varietyData && (varietyData.fillingOperationMin || varietyData.operationMin)) || {};
  var wMins = (varietyData && varietyData.waterOperationMin) || {};

  var newRow = [yearMonth];
  for (var i = 0; i < keys.length; i++) newRow.push(parseFloat(bottles[keys[i]]) || 0);
  for (var i = 0; i < keys.length; i++) newRow.push(Math.round((parseFloat(fKwh[keys[i]]) || 0) * 10) / 10);
  for (var i = 0; i < keys.length; i++) newRow.push(Math.round((parseFloat(wKwh[keys[i]]) || 0) * 10) / 10);
  for (var i = 0; i < keys.length; i++) newRow.push(Math.round(parseFloat(fMins[keys[i]]) || 0));
  for (var i = 0; i < keys.length; i++) newRow.push(Math.round(parseFloat(wMins[keys[i]]) || 0));

  upsertRowByYearMonth(sheetVariety, yearMonth, newRow);
}

/**
 * KPIサマリーの保存 (対象年月キーによるUpsert対応)
 */
function saveKpiSummary(ss, yearMonth, kpi) {
  var sheetKpi = ss.getSheetByName(CONFIG.SHEET_NAMES.KPI);
  var evalData = kpi.evaluation || {};

  var combined = evalData.combined || {};

  var newRow = [
    yearMonth,
    combined.totalKwh || 0,
    combined.operationTimeMin || 0,
    combined.productionBottles || 0,
    combined.kwhPerMinute || 0,
    combined.kwhPerBottle || 0,
    combined.costPerBottleYen || 0,
    kpi.electricitySummary ? kpi.electricitySummary.unitPriceYenPerKwh : 0
  ];

  upsertRowByYearMonth(sheetKpi, yearMonth, newRow);
}

/**
 * シートの初期化・セットアップ
 */
function setupSheets(ss) {
  if (!ss) ss = getSpreadsheet();

  var sheetNames = CONFIG.SHEET_NAMES;
  var cols = CONFIG.COLUMNS;

  // 1. 1時間集計(ALL)
  var sHourly = ss.getSheetByName(sheetNames.HOURLY);
  var header = ['日時キー', '年月日', '時'];
  for (var c = 0; c < cols.length; c++) {
    header.push(cols[c].label);
  }
  header.push('補間フラグ', '水運転(分)', '実充填(分)');

  if (!sHourly) {
    sHourly = ss.insertSheet(sheetNames.HOURLY);
    sHourly.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#f3f3f3');
    sHourly.setFrozenRows(1);
  } else {
    // 既存シートがある場合でも、1行目が空欄であればヘッダーを設定し固定行を1行に調整
    var firstCell = sHourly.getRange(1, 1).getValue();
    if (!firstCell || firstCell === '') {
      sHourly.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#f3f3f3');
      sHourly.setFrozenRows(1);
    }
  }

  // 2. 日別集約
  var sDaily = ss.getSheetByName(sheetNames.DAILY);
  if (!sDaily) {
    sDaily = ss.insertSheet(sheetNames.DAILY);
    var dHeader = ['年月日', '日'];
    for (var i = 0; i < CONFIG.CATEGORIES.length; i++) {
      dHeader.push(CONFIG.CATEGORIES[i].name + ' (kWh)');
    }
    dHeader.push('水運転(分)', '実充填(分)', '合計操業時間(分)');
    sDaily.getRange(1, 1, 1, dHeader.length).setValues([dHeader]).setFontWeight('bold').setBackground('#e8f0fe');
    sDaily.setFrozenRows(1);
  }

  // 3. KPI評価
  var sKpi = ss.getSheetByName(sheetNames.KPI);
  if (!sKpi) {
    sKpi = ss.insertSheet(sheetNames.KPI);
    var kHeader = ['対象年月', '総電力量(kWh)', '操業時間(分)', '生産本数(本)', '時間原単位(kWh/分)', '本原単位(kWh/本)', '1本当たりコスト(円)', '電力量単価(円/kWh)'];
    sKpi.getRange(1, 1, 1, kHeader.length).setValues([kHeader]).setFontWeight('bold').setBackground('#e6f4ea');
    sKpi.setFrozenRows(1);
  }

  // 4. 品種別集約 (実充填・水運転・合算の3モード完全分離対応)
  var sVariety = ss.getSheetByName(sheetNames.VARIETY);
  var vKeys = CONFIG.VARIETY_KEYS;
  var vHeader = ['対象年月'];
  for (var vk = 0; vk < vKeys.length; vk++) vHeader.push(vKeys[vk] + ' (本)');
  for (var vk = 0; vk < vKeys.length; vk++) vHeader.push(vKeys[vk] + ' 実充填(kWh)');
  for (var vk = 0; vk < vKeys.length; vk++) vHeader.push(vKeys[vk] + ' 水運転(kWh)');
  for (var vk = 0; vk < vKeys.length; vk++) vHeader.push(vKeys[vk] + ' 実充填(分)');
  for (var vk = 0; vk < vKeys.length; vk++) vHeader.push(vKeys[vk] + ' 水運転(分)');

  if (!sVariety) {
    sVariety = ss.insertSheet(sheetNames.VARIETY);
    sVariety.getRange(1, 1, 1, vHeader.length).setValues([vHeader]).setFontWeight('bold').setBackground('#fef7e0');
    sVariety.setFrozenRows(1);
  } else if (sVariety.getLastColumn() < vHeader.length) {
    sVariety.getRange(1, 1, 1, vHeader.length).setValues([vHeader]).setFontWeight('bold').setBackground('#fef7e0');
    sVariety.setFrozenRows(1);
  }

  // 5. 燃料集約 (A重油・LNG の熱量と購入費用、品種別本数)
  setupFuelSheet(ss);

  // 6. トータルエネルギー集約 (生産数量・熱量・原油換算量・CO2)
  setupTotalEnergySheet(ss);

  return { initialized: true };
}

// =========================================================================
// 月1行のシート (燃料集約・トータルエネルギー集約) の共通処理
// =========================================================================

/**
 * 月1行のシートへ、複数月の行をまとめて書き込む (A列の対象年月が一致する行は上書き、無ければ末尾へ追記)
 * @param {Sheet} sheet 書き込み先シート (1行目はヘッダー、A列が対象年月)
 * @param {number} colCount シートの列数
 * @param {Array<Array>} newRows 書き込む行 (先頭の要素が 'YYYYMM')。対象年月が6桁の数字でない行は無視する
 * @returns {Object} { updatedCount, appendedCount }
 */
function upsertMonthlyRows(sheet, colCount, newRows) {
  // 既存の行を読み込み、対象年月 → 行位置 の対応を作る
  var lastRow = sheet.getLastRow();
  var sheetRows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, colCount).getValues() : [];
  var rowIndexByYm = {};
  for (var r = 0; r < sheetRows.length; r++) {
    var key = String(sheetRows[r][0] || '').trim();
    if (key && rowIndexByYm[key] === undefined) rowIndexByYm[key] = r;
  }

  var updatedCount = 0;
  var appendedCount = 0;
  for (var i = 0; i < newRows.length; i++) {
    var ym = String(newRows[i][0] || '').trim();
    if (!/^\d{6}$/.test(ym)) continue;

    if (rowIndexByYm[ym] !== undefined) {
      sheetRows[rowIndexByYm[ym]] = newRows[i];
      updatedCount++;
    } else {
      rowIndexByYm[ym] = sheetRows.length;
      sheetRows.push(newRows[i]);
      appendedCount++;
    }
  }

  if (updatedCount + appendedCount > 0) {
    sheet.getRange(2, 1, sheetRows.length, colCount).setValues(sheetRows);
  }
  return { updatedCount: updatedCount, appendedCount: appendedCount };
}

/**
 * 数値ならそのまま、それ以外は空欄 ('') にする (シートへ書き込む値用)
 */
function numberOrBlank(v) {
  return (typeof v === 'number' && isFinite(v)) ? v : '';
}

/**
 * セルの値を数値にする。空欄や数値でない値は null (シートから読んだ値用)
 */
function numberOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = (typeof v === 'number') ? v : parseFloat(v);
  return isFinite(n) ? n : null;
}

// =========================================================================
// 燃料エネルギー (燃料集約シート)
// =========================================================================

/**
 * 燃料集約シートの名前
 */
function getFuelSheetName() {
  return (CONFIG.SHEET_NAMES && CONFIG.SHEET_NAMES.FUEL) || '燃料集約';
}

/**
 * 燃料集約シートのヘッダー (月1行、13列)
 */
function getFuelSheetHeader() {
  var header = ['対象年月', 'A重油 熱量(GJ)', 'LNG 熱量(GJ)', 'A重油 購入費用(千円)', 'LNG 購入費用(千円)'];
  var vKeys = CONFIG.VARIETY_KEYS;
  for (var i = 0; i < vKeys.length; i++) header.push(vKeys[i] + ' (本)');
  return header;
}

/**
 * 燃料集約シートを取得する (無ければ作成する)
 */
function setupFuelSheet(ss) {
  var sheet = ss.getSheetByName(getFuelSheetName());
  if (!sheet) {
    var header = getFuelSheetHeader();
    sheet = ss.insertSheet(getFuelSheetName());
    sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#fce8e6');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * 燃料の月次データをスプレッドシートへ書き込む (複数月をまとめて処理。対象年月が一致する行は上書き、無ければ末尾へ追記)
 * @param {Array<Object>} rows [{ yearMonth, heavyOilGj, lngGj, heavyOilCostThousandYen, lngCostThousandYen, bottles }]
 *   bottles は { [品種キー]: 本数 }。品種別本数が無い月は null (シート上は空欄)
 * @returns {Object} { success, savedCount, updatedCount, appendedCount }
 */
function saveFuelMonthlyData(rows) {
  try {
    if (!rows || !rows.length) return { success: false, error: '保存する燃料データがありません' };

    var ss = getSpreadsheet();
    if (!ss) return { success: false, error: 'スプレッドシートが見つかりません。Config.gs の SPREADSHEET_ID を確認してください。' };

    var sheet = setupFuelSheet(ss);
    var vKeys = CONFIG.VARIETY_KEYS;

    var newRows = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var newRow = [String(row.yearMonth || '').trim(), numberOrBlank(row.heavyOilGj), numberOrBlank(row.lngGj), numberOrBlank(row.heavyOilCostThousandYen), numberOrBlank(row.lngCostThousandYen)];
      for (var v = 0; v < vKeys.length; v++) {
        newRow.push(row.bottles ? (Number(row.bottles[vKeys[v]]) || 0) : '');
      }
      newRows.push(newRow);
    }
    var result = upsertMonthlyRows(sheet, getFuelSheetHeader().length, newRows);
    var updatedCount = result.updatedCount;
    var appendedCount = result.appendedCount;

    return { success: true, savedCount: updatedCount + appendedCount, updatedCount: updatedCount, appendedCount: appendedCount };
  } catch (err) {
    Logger.log('saveFuelMonthlyData error: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 起動時の復元用に、燃料集約シートの保存済みデータを取得する
 * @returns {Object} { success, months: { [ym]: { heavyOilGj, lngGj, heavyOilCostThousandYen, lngCostThousandYen, bottles } } }
 *   空欄のセルは null。品種別本数の8列がすべて空欄の月は bottles が null
 */
function loadSavedFuelData() {
  try {
    var ss = getSpreadsheet();
    if (!ss) return { success: false, error: 'スプレッドシートが見つかりません' };

    var months = {};
    var sheet = ss.getSheetByName(getFuelSheetName());
    if (!sheet || sheet.getLastRow() < 2) return { success: true, months: months };

    var vKeys = CONFIG.VARIETY_KEYS;
    var colCount = Math.min(getFuelSheetHeader().length, sheet.getLastColumn());
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, colCount).getValues();
    var numOrNull = numberOrNull;

    for (var r = 0; r < values.length; r++) {
      var ym = String(values[r][0] || '').trim();
      if (!/^\d{6}$/.test(ym)) continue;

      var bottles = {};
      var hasBottles = false;
      for (var v = 0; v < vKeys.length; v++) {
        var cell = numOrNull(values[r][5 + v]);
        if (cell !== null) hasBottles = true;
        bottles[vKeys[v]] = cell === null ? 0 : cell;
      }

      months[ym] = {
        heavyOilGj: numOrNull(values[r][1]),
        lngGj: numOrNull(values[r][2]),
        heavyOilCostThousandYen: numOrNull(values[r][3]),
        lngCostThousandYen: numOrNull(values[r][4]),
        bottles: hasBottles ? bottles : null
      };
    }

    return { success: true, months: months };
  } catch (err) {
    Logger.log('loadSavedFuelData error: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 対象スプレッドシートを取得する
 * CONFIG.SPREADSHEET_ID が指定されていれば openById で開き、
 * 空文字の場合は getActiveSpreadsheet()（コンテナバインドスクリプト）を利用する
 */
function getSpreadsheet() {
  if (CONFIG.SPREADSHEET_ID && String(CONFIG.SPREADSHEET_ID).trim() !== '') {
    return SpreadsheetApp.openById(String(CONFIG.SPREADSHEET_ID).trim());
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * 復元用サマリーに対象年月の入れ物が無ければ、初期値で作成する
 * @param {Object} monthlySummary { [ym]: {...} }
 * @param {string} ym 'YYYYMM'
 */
function ensureMonthlySummary(monthlySummary, ym) {
  if (monthlySummary[ym]) return;
  monthlySummary[ym] = {
    ym: ym,
    catResult: { categoryMonthlyTotals: {}, categoryDailyTotals: [], monthlyOperationTimes: { waterTimeMin: 0, actualFillingMin: 0 } },
    kpiResult: null,
    externalData: { production: { totalBottles: 0, varieties: {} }, electricity: { unitPriceYenPerKwh: 20.0 } }
  };
}

/**
 * スプレッドシートに保存された集約データ（日別集約シート、品種別集約シートおよびKPI評価シート）を読み込み、
 * クライアントの state.monthlyDatasets 復元用サマリーを返す
 */
function loadSavedSummaryFromSpreadsheet() {
  try {
    var ss = getSpreadsheet();
    if (!ss) return { success: false, message: 'スプレッドシートが見つかりません' };

    var sheetDaily = ss.getSheetByName(CONFIG.SHEET_NAMES.DAILY);
    var sheetKpi = ss.getSheetByName(CONFIG.SHEET_NAMES.KPI);
    var categories = CONFIG.CATEGORIES;

    var monthlySummary = {};
    var savedYmsSet = {};

    // 1. KPI評価シートの読み込み
    if (sheetKpi && sheetKpi.getLastRow() >= 2) {
      var kpiData = sheetKpi.getRange(2, 1, sheetKpi.getLastRow() - 1, 8).getValues();
      for (var k = 0; k < kpiData.length; k++) {
        var row = kpiData[k];
        var ym = String(row[0] || '').trim();
        if (!ym || ym.length !== 6) continue;

        savedYmsSet[ym] = true;
        ensureMonthlySummary(monthlySummary, ym);

        var totKwh = parseFloat(row[1]) || 0;
        var opMin = parseFloat(row[2]) || 0;
        var bottles = parseFloat(row[3]) || 0;
        var kwhPerMin = parseFloat(row[4]) || 0;
        var kwhPerB = parseFloat(row[5]) || 0;
        var costPerB = parseFloat(row[6]) || 0;
        var unitPrice = parseFloat(row[7]) || 0;

        monthlySummary[ym].externalData.production.totalBottles = bottles;
        monthlySummary[ym].externalData.electricity.unitPriceYenPerKwh = unitPrice;

        monthlySummary[ym].kpiResult = {
          electricitySummary: {
            usedKwhThousand: Math.round(totKwh / 100) / 10,
            costThousandYen: Math.round((totKwh * unitPrice) / 100) / 10,
            unitPriceYenPerKwh: unitPrice
          },
          evaluation: {
            combined: {
              mode: '水運転＋実充填',
              productionBottles: bottles,
              operationTimeMin: opMin,
              totalKwh: totKwh,
              kwhPerMinute: kwhPerMin,
              kwhPerBottle: kwhPerB,
              costPerBottleYen: costPerB
            },
            waterOnly: { mode: '水運転のみ', productionBottles: 0, operationTimeMin: 0, totalKwh: 0, kwhPerMinute: 0, kwhPerBottle: 0, costPerBottleYen: 0 },
            fillingOnly: { mode: '実充填のみ', productionBottles: bottles, operationTimeMin: opMin, totalKwh: totKwh, kwhPerMinute: kwhPerMin, kwhPerBottle: kwhPerB, costPerBottleYen: costPerB }
          }
        };
      }
    }

    // 2. 日別集約シートの読み込み
    if (sheetDaily && sheetDaily.getLastRow() >= 2) {
      var numCols = 2 + categories.length + 3;
      var dailyData = sheetDaily.getRange(2, 1, sheetDaily.getLastRow() - 1, numCols).getValues();

      for (var d = 0; d < dailyData.length; d++) {
        var dRow = dailyData[d];
        var dateStr = formatDateCell(dRow[0]);
        if (!dateStr || dateStr.indexOf('/') === -1) continue;

        var parts = dateStr.split('/');
        if (parts.length < 2) continue;
        var ym = parts[0] + parts[1].padStart(2, '0');

        savedYmsSet[ym] = true;
        ensureMonthlySummary(monthlySummary, ym);

        var catTotals = monthlySummary[ym].catResult.categoryMonthlyTotals;
        var dayNum = parseInt(dRow[1], 10) || (parts.length >= 3 ? parseInt(parts[2], 10) : 1);
        var dayCats = {};
        for (var c = 0; c < categories.length; c++) {
          var catName = categories[c].name;
          var val = parseFloat(dRow[2 + c]) || 0;
          dayCats[catName] = val;
          if (!catTotals[catName]) {
            catTotals[catName] = { grandTotal: 0 };
          }
          catTotals[catName].grandTotal = Math.round((catTotals[catName].grandTotal + val) * 10) / 10;
        }

        var wMin = parseFloat(dRow[2 + categories.length]) || 0;
        var fMin = parseFloat(dRow[2 + categories.length + 1]) || 0;
        var opTimes = monthlySummary[ym].catResult.monthlyOperationTimes;
        opTimes.waterTimeMin += wMin;
        opTimes.actualFillingMin += fMin;

        monthlySummary[ym].catResult.categoryDailyTotals.push({
          date: dateStr,
          day: dayNum,
          categories: dayCats,
          operationTimes: {
            waterTimeMin: wMin,
            actualFillingMin: fMin,
            totalOperationMin: wMin + fMin
          }
        });
      }
    }

    // 3. 品種別集約シートの読み込み (実充填・水運転・合算の完全分離復元)
    var sheetVariety = ss.getSheetByName(CONFIG.SHEET_NAMES.VARIETY);
    if (sheetVariety && sheetVariety.getLastRow() >= 2) {
      var vKeys = CONFIG.VARIETY_KEYS;
      var lastCol = sheetVariety.getLastColumn();
      var vData = sheetVariety.getRange(2, 1, sheetVariety.getLastRow() - 1, lastCol).getValues();

      for (var v = 0; v < vData.length; v++) {
        var vRow = vData[v];
        var ym = String(vRow[0] || '').trim();
        if (!ym || ym.length !== 6) continue;

        savedYmsSet[ym] = true;
        ensureMonthlySummary(monthlySummary, ym);

        var vBottles = {};
        var vFillingPower = {};
        var vWaterPower = {};
        var vCombPower = {};
        var vFillingMins = {};
        var vWaterMins = {};
        var vCombMins = {};

        if (lastCol >= 1 + vKeys.length * 5) {
          // 41列フォーマット (実充填・水運転・合算の完全分離)
          for (var vk = 0; vk < vKeys.length; vk++) {
            var k = vKeys[vk];
            vBottles[k] = parseFloat(vRow[1 + vk]) || 0;
            vFillingPower[k] = parseFloat(vRow[1 + vKeys.length + vk]) || 0;
            vWaterPower[k] = parseFloat(vRow[1 + vKeys.length * 2 + vk]) || 0;
            vCombPower[k] = Math.round((vFillingPower[k] + vWaterPower[k]) * 10) / 10;

            vFillingMins[k] = parseFloat(vRow[1 + vKeys.length * 3 + vk]) || 0;
            vWaterMins[k] = parseFloat(vRow[1 + vKeys.length * 4 + vk]) || 0;
            vCombMins[k] = Math.round(vFillingMins[k] + vWaterMins[k]);
          }
        } else {
          // 旧25列フォーマットの後方互換フォールバック
          for (var vk = 0; vk < vKeys.length; vk++) {
            var k = vKeys[vk];
            vBottles[k] = parseFloat(vRow[1 + vk]) || 0;
            vCombPower[k] = parseFloat(vRow[1 + vKeys.length + vk]) || 0;
            vCombMins[k] = parseFloat(vRow[1 + vKeys.length * 2 + vk]) || 0;
            vFillingPower[k] = vCombPower[k];
            vFillingMins[k] = vCombMins[k];
            vWaterPower[k] = 0;
            vWaterMins[k] = 0;
          }
        }

        // 月報PET由来の品種別本数を格納
        monthlySummary[ym].externalData.production.varieties = vBottles;
        // 品種別電力・時間を操業モード別に完全格納
        monthlySummary[ym].varietyAgg = {
          combined: { powerKwh: vCombPower, operationMin: vCombMins },
          waterOnly: { powerKwh: vWaterPower, operationMin: vWaterMins },
          fillingOnly: { powerKwh: vFillingPower, operationMin: vFillingMins }
        };
      }
    }

    // 4. KPI評価およびカテゴリ集約のフォールバック補完
    for (var ymKey in monthlySummary) {
      var ms = monthlySummary[ymKey];
      if (ms.kpiResult && ms.kpiResult.evaluation && ms.kpiResult.evaluation.combined) {
        var comb = ms.kpiResult.evaluation.combined;
        if (!ms.catResult.categoryMonthlyTotals['総電力'] || ms.catResult.categoryMonthlyTotals['総電力'].grandTotal === 0) {
          ms.catResult.categoryMonthlyTotals['総電力'] = { grandTotal: comb.totalKwh || 0 };
        }
        if (ms.catResult.monthlyOperationTimes.actualFillingMin === 0 && ms.catResult.monthlyOperationTimes.waterTimeMin === 0) {
          ms.catResult.monthlyOperationTimes.actualFillingMin = comb.operationTimeMin || 0;
        }
      }
    }

    var savedYms = Object.keys(savedYmsSet).sort();

    return {
      success: true,
      savedYms: savedYms,
      monthlySummary: monthlySummary,
      config: CONFIG
    };
  } catch (err) {
    Logger.log('loadSavedSummaryFromSpreadsheet error: ' + err.message);
    return { success: false, error: err.message };
  }
}

// =========================================================================
// トータルエネルギー (トータルエネルギー集約シート)
// =========================================================================

/**
 * トータルエネルギー集約シートの名前
 */
function getTotalEnergySheetName() {
  return (CONFIG.SHEET_NAMES && CONFIG.SHEET_NAMES.TOTAL_ENERGY) || 'トータルエネルギー集約';
}

/**
 * トータルエネルギー集約シートのヘッダー (対象年月 + CONFIG.TOTAL_ENERGY_SHEET_COLUMNS の列)
 */
function getTotalEnergySheetHeader() {
  var columns = CONFIG.TOTAL_ENERGY_SHEET_COLUMNS || [];
  var header = ['対象年月'];
  for (var i = 0; i < columns.length; i++) header.push(columns[i].header);
  return header;
}

/**
 * トータルエネルギー集約シートを取得する (無ければ作成する)
 */
function setupTotalEnergySheet(ss) {
  var sheet = ss.getSheetByName(getTotalEnergySheetName());
  if (!sheet) {
    var header = getTotalEnergySheetHeader();
    sheet = ss.insertSheet(getTotalEnergySheetName());
    sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#e0f2f1');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * トータルエネルギーの月次データをスプレッドシートへ書き込む (複数月をまとめて処理。対象年月が一致する行は上書き、無ければ末尾へ追記)
 * @param {Array<Object>} rows [{ yearMonth, productionCases, litersPerCase, heavyOilGj, ... }]
 *   項目は CONFIG.TOTAL_ENERGY_SHEET_COLUMNS の key。値が無い項目 (null) は空欄として書き込む
 * @returns {Object} { success, savedCount, updatedCount, appendedCount }
 */
function saveTotalEnergyMonthlyData(rows) {
  try {
    if (!rows || !rows.length) return { success: false, error: '保存するトータルエネルギーのデータがありません' };

    var columns = CONFIG.TOTAL_ENERGY_SHEET_COLUMNS || [];
    if (columns.length === 0) return { success: false, error: 'Config.gs に TOTAL_ENERGY_SHEET_COLUMNS がありません。Config.gs を更新してください。' };

    var ss = getSpreadsheet();
    if (!ss) return { success: false, error: 'スプレッドシートが見つかりません。Config.gs の SPREADSHEET_ID を確認してください。' };

    var sheet = setupTotalEnergySheet(ss);
    var newRows = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var newRow = [String(row.yearMonth || '').trim()];
      for (var c = 0; c < columns.length; c++) newRow.push(numberOrBlank(row[columns[c].key]));
      newRows.push(newRow);
    }
    var result = upsertMonthlyRows(sheet, columns.length + 1, newRows);

    return { success: true, savedCount: result.updatedCount + result.appendedCount, updatedCount: result.updatedCount, appendedCount: result.appendedCount };
  } catch (err) {
    Logger.log('saveTotalEnergyMonthlyData error: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 起動時の復元用に、トータルエネルギー集約シートの保存済みデータを取得する
 * @returns {Object} { success, months: { [ym]: { productionCases, litersPerCase, heavyOilGj, ... } } }
 *   項目は CONFIG.TOTAL_ENERGY_SHEET_COLUMNS の key。空欄のセルは null
 */
function loadSavedTotalEnergyData() {
  try {
    var ss = getSpreadsheet();
    if (!ss) return { success: false, error: 'スプレッドシートが見つかりません' };

    var months = {};
    var sheet = ss.getSheetByName(getTotalEnergySheetName());
    if (!sheet || sheet.getLastRow() < 2) return { success: true, months: months };

    var columns = CONFIG.TOTAL_ENERGY_SHEET_COLUMNS || [];
    var colCount = Math.min(columns.length + 1, sheet.getLastColumn());
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, colCount).getValues();

    for (var r = 0; r < values.length; r++) {
      var ym = String(values[r][0] || '').trim();
      if (!/^\d{6}$/.test(ym)) continue;

      var month = {};
      for (var c = 0; c < columns.length; c++) month[columns[c].key] = numberOrNull(values[r][c + 1]);
      months[ym] = month;
    }

    return { success: true, months: months };
  } catch (err) {
    Logger.log('loadSavedTotalEnergyData error: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Excelエクスポート用に「日別集約」「KPI評価」「品種別集約」「燃料集約」「トータルエネルギー集約」シートの全生データを取得
 * @returns {Object} { success: true, sheets: { '日別集約': [...], 'KPI評価': [...], '品種別集約': [...], '燃料集約': [...], 'トータルエネルギー集約': [...] } }
 */
function getSheetsDataForExport() {
  try {
    var ss = getSpreadsheet();
    if (!ss) return { success: false, error: 'スプレッドシートが見つかりません' };

    var targetSheetNames = [
      CONFIG.SHEET_NAMES.DAILY,   // '日別集約'
      CONFIG.SHEET_NAMES.KPI,     // 'KPI評価'
      CONFIG.SHEET_NAMES.VARIETY, // '品種別集約'
      getFuelSheetName(),         // '燃料集約'
      getTotalEnergySheetName()   // 'トータルエネルギー集約'
    ];

    var resultSheets = {};
    var timeZone = Session.getScriptTimeZone() || 'Asia/Tokyo';

    for (var i = 0; i < targetSheetNames.length; i++) {
      var sName = targetSheetNames[i];
      var sheet = ss.getSheetByName(sName);
      if (sheet && sheet.getLastRow() >= 1 && sheet.getLastColumn() >= 1) {
        var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
        // Dateオブジェクトがあれば YYYY/MM/DD 文字列に安全変換
        for (var r = 0; r < values.length; r++) {
          for (var c = 0; c < values[r].length; c++) {
            if (values[r][c] instanceof Date) {
              values[r][c] = Utilities.formatDate(values[r][c], timeZone, 'yyyy/MM/dd');
            }
          }
        }
        resultSheets[sName] = values;
      } else {
        resultSheets[sName] = [];
      }
    }

    return {
      success: true,
      sheets: resultSheets
    };
  } catch (err) {
    Logger.log('getSheetsDataForExport error: ' + err.message);
    return { success: false, error: err.message };
  }
}

