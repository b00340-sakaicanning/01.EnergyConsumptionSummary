/**
 * gas_app/js/etl/csvParser.js
 * CSV/テキスト高速パースおよび電力(kW)列動的抽出モジュール
 * ブラウザ環境およびNode.js環境両対応
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppConfig = require('../config.js');
    module.exports = factory(AppConfig);
  } else {
    root.CsvParser = factory(root.AppConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (AppConfig) {

  /**
   * テキストファイル先頭またはファイル名からタグNoを特定する
   */
  function detectTagType(fileName, firstFewLines) {
    // 1. ファイル名パターン (tag02, 202503_tag02, AQ20240401_002.TXT 等)
    const nameMatch = fileName.match(/tag0?([24567])/i) || fileName.match(/_00?([24567])(?:\.[^.]+)?$/i);
    if (nameMatch) {
      return `tag0${nameMatch[1]}`;
    }

    // 2. 行内容（収集タグNo.）から判定
    for (let i = 0; i < Math.min(firstFewLines.length, 5); i++) {
      const line = firstFewLines[i];
      if (line.includes('収集タグNo.')) {
        const m = line.match(/"?収集タグNo\."?,?"?(\d+)"?/);
        if (m) {
          const num = parseInt(m[1], 10);
          return num < 10 ? `tag0${num}` : `tag${num}`;
        }
      }
    }
    return null;
  }

  /**
   * 1つのCSV/TXT文字列をパースし、ヘッダー情報とデータ行を分解する
   */
  function parseSingleFile(fileContent, fileName = '') {
    const lines = fileContent.split(/\r?\n/);
    if (lines.length < 5) {
      return null;
    }

    const tagType = detectTagType(fileName, lines.slice(0, 5));
    if (!tagType) {
      return null;
    }

    // 動的に「名称」行、「単位」行、「データ開始行」を走査・特定
    // （生のTXTファイルでは空行が挟まる場合があり、結合済みファイルでは空行が除かれている場合があるため両対応）
    let nameRow = null;
    let unitRow = null;
    let dataStartIndex = -1;

    for (let i = 0; i < Math.min(lines.length, 25); i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = parseCsvLine(line);
      const firstCol = (cols[0] || '').replace(/"/g, '').trim();

      if (firstCol === '名称') {
        nameRow = cols;
      } else if (firstCol === '単位') {
        unitRow = cols;
      } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(firstCol)) {
        dataStartIndex = i;
        break;
      }
    }

    if (!nameRow || !unitRow || dataStartIndex < 0) {
      return null;
    }

    // tagType内の全kW列インデックスを走査・特定
    const kwColIndices = [];
    let varietyColIdx = -1;
    let stepColIdx = -1;

    for (let c = 0; c < unitRow.length; c++) {
      const unit = (unitRow[c] || '').replace(/"/g, '').trim().toLowerCase();
      const colName = (nameRow[c] || '').replace(/"/g, '').trim();

      if (tagType === 'tag02') {
        if (colName.includes('D99:品種') || colName.includes('品種')) {
          varietyColIdx = c;
        } else if (colName.includes('ステップ')) {
          stepColIdx = c;
        }
      }

      if (unit === 'kw') {
        kwColIndices.push(c);
      }
    }

    // AppConfig.EQUIPMENT_COLUMNS と照合
    // 各設定で tag === tagType かつ kwIndex が一致するものをマッピング
    const columnMappings = []; // [{ colLetter, fileColIndex }]
    for (const eq of AppConfig.EQUIPMENT_COLUMNS) {
      if (eq.tag === tagType && eq.kwIndex !== undefined) {
        if (eq.kwIndex < kwColIndices.length) {
          columnMappings.push({
            colLetter: eq.col,
            fileColIndex: kwColIndices[eq.kwIndex]
          });
        }
      }
    }

    // データ行のパース (dataStartIndex以降)
    const recordsByTimestamp = new Map();
    // 直前有効値のトラッキング（外れ値・センサー異常コード補正用）
    const lastValidValues = {};

    for (let i = dataStartIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = parseCsvLine(line);
      if (cols.length < 2) continue;

      const dateStr = cols[0].replace(/"/g, '').trim(); // e.g. 2025/03/01
      const timeStr = cols[1].replace(/"/g, '').trim(); // e.g. 00:00:00
      if (!dateStr || !timeStr || !dateStr.includes('/')) continue;

      const tsKey = `${dateStr} ${timeStr}`;
      const rowObj = {};

      if (tagType === 'tag02') {
        if (varietyColIdx >= 0) rowObj['variety'] = cols[varietyColIdx] ? parseInt(cols[varietyColIdx], 10) : null;
        if (stepColIdx >= 0) rowObj['step'] = cols[stepColIdx] ? parseInt(cols[stepColIdx], 10) : null;
      }

      for (const mapping of columnMappings) {
        const valStr = cols[mapping.fileColIndex];
        if (valStr !== undefined && valStr !== '') {
          const num = parseFloat(valStr.replace(/"/g, ''));
          if (isNaN(num)) {
            rowObj[mapping.colLetter] = null;
          } else {
            // 外れ値・センサー異常値補正:
            // 1. 1,000 kW以上（21,000,000や210,000,000等のPLC通信エラーコード・断線・オーバーレンジ）
            // 2. 直前の有効値と明らかに大きく違う場合（急激なスパイク: 差分500 kW超）
            const prev = lastValidValues[mapping.colLetter];
            let isOutlier = (num >= 1000.0);
            if (!isOutlier && prev !== undefined && prev !== null) {
              if (Math.abs(num - prev) > 500.0) {
                isOutlier = true;
              }
            }
            if (isOutlier) {
              rowObj[mapping.colLetter] = (prev !== undefined && prev !== null) ? prev : 0.0;
            } else {
              rowObj[mapping.colLetter] = num;
              lastValidValues[mapping.colLetter] = num;
            }
          }
        } else {
          rowObj[mapping.colLetter] = null;
        }
      }

      recordsByTimestamp.set(tsKey, rowObj);
    }

    return {
      tagType,
      fileName,
      columnCount: columnMappings.length,
      rowCount: recordsByTimestamp.size,
      records: recordsByTimestamp
    };
  }

  /**
   * カンマ区切り行のパース（ダブルクォート考慮）
   */
  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  /**
   * 複数タグのファイルをタイムスタンプキーで横持ち結合する
   */
  function mergeTagFiles(files) {
    const parsedFiles = [];
    for (const f of files) {
      const parsed = parseSingleFile(f.content, f.fileName);
      if (parsed) {
        parsedFiles.push(parsed);
      }
    }

    const allTimestampsSet = new Set();
    for (const pf of parsedFiles) {
      for (const ts of pf.records.keys()) {
        allTimestampsSet.add(ts);
      }
    }

    const sortedTimestamps = Array.from(allTimestampsSet).sort();
    const mergedMap = new Map();

    for (const ts of sortedTimestamps) {
      const mergedRow = {};
      for (const pf of parsedFiles) {
        const row = pf.records.get(ts);
        if (row) {
          Object.assign(mergedRow, row);
        }
      }
      mergedMap.set(ts, mergedRow);
    }

    return mergedMap;
  }

  function groupFilesByYearMonth(files) {
    const groups = {};
    for (const f of files) {
      let ym = null;
      const m = f.fileName.match(/(20\d{2})(0[1-9]|1[0-2])/);
      if (m) {
        ym = `${m[1]}${m[2]}`;
      } else {
        const lines = f.content.slice(0, 2000).split(/\r?\n/);
        for (const l of lines) {
          const dateMatch = l.match(/(20\d{2})\/(0[1-9]|1[0-2])\/\d{2}/);
          if (dateMatch) {
            ym = `${dateMatch[1]}${dateMatch[2]}`;
            break;
          }
        }
      }

      const key = ym || 'unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    }
    return groups;
  }

  return {
    detectTagType,
    parseSingleFile,
    parseCsvLine,
    mergeTagFiles,
    groupFilesByYearMonth
  };
}));
