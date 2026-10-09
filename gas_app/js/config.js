/**
 * gas_app/js/config.js
 * 電力集計システム マスター定義・カラムマッピング
 * ブラウザ環境 (window) および Node.js 環境 (module.exports) 両対応
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AppConfig = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // 品種マスター (Excel原紙「品種」シート完全準拠)
  const VARIETY_MASTER = {
    100: '停　止',
    101: '２Ｌ 長角',
    102: '1.5L 長角',
    103: '１Ｌ 長角',
    104: '900ml 長角',
    105: '600ml 丸',
    106: '525ml 丸',
    107: '500ml 丸',
    108: '500ml 角',
    109: '350ml 角',
    110: '280ml 丸',
    111: 'その他(予備1)',
    112: 'その他(予備2)',
    113: 'その他(予備3)',
    114: 'その他(予備4)',
    115: 'その他(予備5)'
  };

  // 品種8大分類グループ (Excel原紙・月別電力使用量集約グラフ表示(総電力 2024).xlsx 準拠)
  const VARIETY_GROUPS = [
    { key: '2.0L', name: '2.0L', capacityL: 2.0, bpm: 180, codes: [101], color: '#2563eb' },
    { key: '1.5L', name: '1.5L', capacityL: 1.5, bpm: 240, codes: [102], color: '#0891b2' },
    { key: '1.0L', name: '1.0L', capacityL: 1.0, bpm: 250, codes: [103, 104], color: '#059669' },
    { key: '600mL丸', name: '600ｍL丸', capacityL: 0.6, bpm: 420, codes: [105], color: '#65a30d' },
    { key: '500mL丸', name: '500ｍL丸', capacityL: 0.5, bpm: 500, codes: [106, 107], color: '#d97706' },
    { key: '500mL角', name: '500ｍL角', capacityL: 0.5, bpm: 500, codes: [108], color: '#ea580c' },
    { key: '350mL', name: '350ｍL', capacityL: 0.35, bpm: 500, codes: [109], color: '#7c3aed' },
    { key: '280mL', name: '280ｍL', capacityL: 0.28, bpm: 500, codes: [110], color: '#db2777' }
  ];

  // 品種8大分類キー (表示・集計の並び順)
  const VARIETY_KEYS = VARIETY_GROUPS.map(g => g.key);

  /**
   * 品種合算マッピング設定
   * 8大分類キーに対して、月報Excel（月報PET）内のどの品種を紐付けて合算するかを定義
   */
  const VARIETY_MAPPING = {
    '2.0L': ['2.0L', '2L'],
    '1.5L': ['1.5L'],
    '1.0L': ['1.0L長角', '1.0L正角', '1.0L', '1L'],
    '600mL丸': ['600mL丸', '600ml丸'],
    '500mL丸': ['500mL丸', '500ml丸', '550mL丸', '550ml丸'], // 500ml丸と550ml丸を合算
    '500mL角': ['500mL角', '500ml角'],
    '350mL': ['350mL', '350ml'],
    '280mL': ['280mL', '280ml']
  };

  // 評価指標マスター (Excel原紙準拠)
  const EVALUATION_METRICS = [
    { key: 'powerKwh', name: '電力量', unit: 'kWh', digits: 1 },
    { key: 'operationMin', name: '操業時間', unit: '分', digits: 0 },
    { key: 'productionBottles', name: '生産本数', unit: '本', digits: 0 },
    { key: 'kwhPerBottle', name: '単位本電力量', unit: 'kWh/本', digits: 4 },
    { key: 'kwhPerMinute', name: '単位時間電力量', unit: 'kWh/分', digits: 2 },
    { key: 'powerCostYen', name: '電力コスト', unit: '円', digits: 0 },
    { key: 'costPerBottle', name: '単位本コスト', unit: '円/本', digits: 4 },
    { key: 'costPerMinute', name: '単位時間コスト', unit: '円/分', digits: 2 }
  ];

  // 燃料エネルギー (A重油 + LNG) の評価指標マスター。isRate が true のものは原単位・平均系
  const FUEL_METRICS = [
    { key: 'fuelMj', name: '燃料エネルギー', unit: 'MJ', digits: 0, isRate: false },
    { key: 'operationMin', name: '操業時間', unit: '分', digits: 0, isRate: false },
    { key: 'productionBottles', name: '生産本数', unit: '本', digits: 0, isRate: false },
    { key: 'mjPerBottle', name: '単位本燃料エネルギー', unit: 'MJ/本', digits: 4, isRate: true },
    { key: 'mjPerMinute', name: '単位時間燃料エネルギー', unit: 'MJ/分', digits: 2, isRate: true },
    { key: 'fuelCostYen', name: '燃料エネルギーコスト', unit: '円', digits: 0, isRate: false },
    { key: 'costPerBottle', name: '単位本コスト', unit: '円/本', digits: 4, isRate: true },
    { key: 'costPerMinute', name: '単位時間コスト', unit: '円/分', digits: 2, isRate: true }
  ];

  // トータルエネルギーのエネルギー源マスター (熱量・CO2 の内訳の並びと色)
  const TOTAL_ENERGY_SOURCES = [
    { key: 'heavyOil', name: 'A重油', gjKey: 'heavyOilGj', co2Key: 'heavyOilCo2', color: '#ea580c' },
    { key: 'lng', name: 'LNG', gjKey: 'lngGj', co2Key: 'lngCo2', color: '#0891b2' },
    { key: 'electricity', name: '電気', gjKey: 'electricityGj', co2Key: 'electricityCo2', color: '#ca8a04' }
  ];

  // スプレッドシート「トータルエネルギー集約」の列 (対象年月に続く列。key は月次データの項目名)
  const TOTAL_ENERGY_SHEET_COLUMNS = [
    { key: 'productionCases', header: '生産数量(ケース)' },
    { key: 'litersPerCase', header: '1ケースあたりの容量(L)' },
    { key: 'heavyOilGj', header: 'A重油 熱量(GJ)' },
    { key: 'lngGj', header: 'LNG 熱量(GJ)' },
    { key: 'electricityGj', header: '電気 熱量(GJ)' },
    { key: 'totalGj', header: '合計 熱量(GJ)' },
    { key: 'crudeOilKl', header: '原油換算量(kl)' },
    { key: 'heavyOilCo2', header: 'A重油 CO2(t-CO2)' },
    { key: 'lngCo2', header: 'LNG CO2(t-CO2)' },
    { key: 'electricityCo2', header: '電気 CO2(t-CO2)' },
    { key: 'totalCo2', header: '合計 CO2(t-CO2)' },
    { key: 'solarKwhThousand', header: '太陽光 発電量(千kWh)' },
    { key: 'solarGj', header: '太陽光 熱量(GJ)' },
    { key: 'solarCo2', header: '太陽光 CO2(t-CO2)' },
    { key: 'noSolarCrudeOilKl', header: '原油換算量 太陽光無し想定(kl)' }
  ];

  // 原単位・平均系の指標 (単位本、単位時間)。総量系と違い、積み上げ・累計の対象にならない
  const RATE_METRIC_KEYS = ['kwhPerBottle', 'costPerBottle', 'kwhPerMinute', 'costPerMinute'];

  // 年度 (4月〜翌3月) の月の並び
  const FISCAL_MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
  const FISCAL_MONTH_LABELS = FISCAL_MONTH_ORDER.map(m => `${m}月`);

  /**
   * 暦年・月から年度を求める (4月〜12月: 当年、1月〜3月: 前年)
   */
  function getFiscalYear(year, month) {
    return month >= 4 ? year : year - 1;
  }

  // ステップマスター (工程分類) - 原紙Excel「ステップ」シート準拠 (全57件)
  const STEP_MASTER = {
    0: { name: '停止(仮)', category: 'その他', code: 0 },
    1: { name: '給水', category: 'SIP', code: 10 },
    2: { name: '循環昇温', category: 'SIP', code: 10 },
    3: { name: '給湯', category: 'SIP', code: 10 },
    4: { name: '循環加熱', category: 'SIP', code: 10 },
    5: { name: '滅菌保持', category: 'SIP', code: 10 },
    6: { name: '冷却１', category: 'SIP', code: 10 },
    7: { name: '冷却２', category: 'SIP', code: 10 },
    8: { name: '温度安定化', category: '水運転', code: 20 },
    9: { name: 'フィラー昇温待機', category: '水運転', code: 20 },
    10: { name: 'フィラー昇温', category: '水運転', code: 20 },
    11: { name: '水運転', category: '水運転', code: 20 },
    12: { name: '原液置換', category: '実充填', code: 30 },
    13: { name: '原液循環', category: '実充填', code: 30 },
    14: { name: '次工程送液', category: '実充填', code: 30 },
    15: { name: 'ＢＴ排出', category: '実充填', code: 30 },
    16: { name: '水押し', category: '実充填', code: 30 },
    17: { name: 'すすぎ', category: '水運転', code: 20 },
    18: { name: '水運転待機', category: '水運転', code: 20 },
    19: { name: '機器冷却', category: 'その他', code: 0 },
    20: { name: '動力停止', category: 'その他', code: 0 },
    25: { name: '殺菌温度異常', category: '実充填', code: 30 },
    26: { name: '殺菌異常回収', category: '実充填', code: 30 },
    27: { name: '殺菌異常すすぎ', category: '水運転', code: 20 },
    28: { name: '殺菌異常水運転', category: '水運転', code: 20 },
    30: { name: '滞留オーバー', category: 'その他', code: 0 },
    31: { name: '滞留回収', category: 'その他', code: 0 },
    51: { name: '温水すすぎ１', category: 'CIP', code: 40 },
    52: { name: '温水すすぎ２', category: 'CIP', code: 40 },
    53: { name: 'ＡＬ１送液１', category: 'CIP', code: 40 },
    54: { name: 'ＡＬ１送液２', category: 'CIP', code: 40 },
    55: { name: 'ＡＬ１循環', category: 'CIP', code: 40 },
    56: { name: 'ＡＬ１排出', category: 'CIP', code: 40 },
    57: { name: 'ＡＬ１すすぎ１', category: 'CIP', code: 40 },
    58: { name: 'ＡＬ１すすぎ２', category: 'CIP', code: 40 },
    59: { name: 'ＡＣ１送液１', category: 'CIP', code: 40 },
    60: { name: 'ＡＣ１送液２', category: 'CIP', code: 40 },
    61: { name: 'ＡＣ１循環', category: 'CIP', code: 40 },
    62: { name: 'ＡＣ１排出', category: 'CIP', code: 40 },
    63: { name: 'ＡＣ１すすぎ１', category: 'CIP', code: 40 },
    64: { name: 'ＡＣ１すすぎ２', category: 'CIP', code: 40 },
    65: { name: 'ＡＬ２送液１', category: 'CIP', code: 40 },
    66: { name: 'ＡＬ２送液２', category: 'CIP', code: 40 },
    67: { name: 'ＡＬ２循環', category: 'CIP', code: 40 },
    68: { name: 'ＡＬ２排出', category: 'CIP', code: 40 },
    69: { name: 'ＡＬ２すすぎ１', category: 'CIP', code: 40 },
    70: { name: 'ＡＬ２すすぎ２', category: 'CIP', code: 40 },
    71: { name: 'ＡＣ２送液１', category: 'CIP', code: 40 },
    72: { name: 'ＡＣ２送液２', category: 'CIP', code: 40 },
    73: { name: 'ＡＣ２循環', category: 'CIP', code: 40 },
    74: { name: 'ＡＣ２排出', category: 'CIP', code: 40 },
    75: { name: 'ＡＣ２すすぎ１', category: 'CIP', code: 40 },
    76: { name: 'ＡＣ２すすぎ２', category: 'CIP', code: 40 },
    77: { name: '最終すすぎ１', category: 'CIP', code: 40 },
    78: { name: '最終すすぎ２', category: 'CIP', code: 40 },
    79: { name: '残水ブロー', category: 'CIP', code: 40 },
    80: { name: 'ＣＩＰ終了', category: 'CIP', code: 40 }
  };

  // 工程カテゴリ定義
  const CATEGORIES = [
    { key: 'total', name: '総電力', sheetName: '1時間集計(総電力用)' },
    { key: 'utility', name: 'ユーティリティ', sheetName: '1時間集計(ユーティリティ)' },
    { key: 'compressor', name: 'コンプレッサー', sheetName: '1時間集計(コンプレッサー)' },
    { key: 'boiler', name: 'ボイラー', sheetName: '1時間集計(ボイラー)' },
    { key: 'pureWater', name: '純水装置', sheetName: '1時間集計(純水装置)' },
    { key: 'drainWater', name: '排水処理', sheetName: '1時間集計(排水処理)' },
    { key: 'chiller', name: 'チラー', sheetName: '1時間集計(チラー)' },
    { key: 'mixing', name: '調合抽出', sheetName: '1時間集計(調合抽出)' },
    { key: 'supply', name: '供給', sheetName: '1時間集計(供給)' },
    { key: 'filling', name: '充填', sheetName: '1時間集計(充填)' },
    { key: 'packaging', name: '包装', sheetName: '1時間集計(包装)' }
  ];

  // 各工程シートが合算する列リスト (Excel実績シートと完全一致)
  const CATEGORY_COLUMN_MAP = {
    'utility': ['H', 'K', 'I', 'J', 'AK'],
    'compressor': ['H'],
    'boiler': ['K'],
    'pureWater': ['I'],
    'drainWater': ['J'],
    'chiller': ['AK'],
    'mixing': ['CC', 'CH', 'CI', 'CJ', 'CK'],
    'supply': ['BW', 'BZ', 'CE', 'CF'],
    'filling': ['BV', 'BX', 'CG', 'CM', 'CN', 'CO'],
    'packaging': ['BF', 'BP', 'BQ', 'BR', 'BS', 'BT', 'BU', 'BY', 'CL'],
    'total': [
      'G', 'H', 'I', 'J', 'K', 'L', 'M',
      'AT', 'AU', 'AV', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BB', 'BC',
      'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BK', 'BL', 'BM', 'BN', 'BO',
      'BP', 'BQ', 'BR', 'BS', 'BT', 'BU', 'BV', 'BW', 'BX', 'BY', 'BZ', 'CA', 'CB',
      'CC', 'CD', 'CE', 'CF', 'CG', 'CH', 'CI', 'CJ', 'CK', 'CL', 'CM', 'CN', 'CO'
    ]
  };


  // 全90列のカラムマッピング定義 (D列〜CO列)
  // tag: タグ種別, kwIndex: 各タグ内のkW列出現順序(0始まり), fixedVal: 固定値(未計測盤)
  const EQUIPMENT_COLUMNS = [
    // tag04 (コンプレッサー No1〜No3)
    { col: 'D', tag: 'tag04', kwIndex: 0, label: 'コンプレッサー No1' },
    { col: 'E', tag: 'tag04', kwIndex: 1, label: 'コンプレッサー No2' },
    { col: 'F', tag: 'tag04', kwIndex: 2, label: 'コンプレッサー No3' },

    // tag05 (1021-1109)
    { col: 'G', tag: 'tag05', kwIndex: 0, label: '1F 低圧動力盤 №1 AMPAC' },
    { col: 'H', tag: 'tag05', kwIndex: 1, label: '1F 低圧動力盤 №2 ｺﾝﾌﾟﾚｯｻｰ制御盤' },
    { col: 'I', tag: 'tag05', kwIndex: 2, label: '井水純水制御盤' },
    { col: 'J', tag: 'tag05', kwIndex: 3, label: '排水処理制御盤' },
    { col: 'K', tag: 'tag05', kwIndex: 4, label: 'ﾎﾞｲﾗｰ制御盤' },
    { col: 'L', tag: 'tag05', kwIndex: 5, label: 'ｶｯﾌﾟ殺菌制御盤' },
    { col: 'M', tag: null, fixedVal: 0.0, label: '消火ﾎﾟﾝﾌﾟ盤' },
    { col: 'N', tag: 'tag05', kwIndex: 6, label: '排水処理棟 原水ﾎﾟﾝﾌﾟ1号' },
    { col: 'O', tag: 'tag05', kwIndex: 7, label: '排水処理棟 原水ﾎﾟﾝﾌﾟ2号' },
    { col: 'P', tag: 'tag05', kwIndex: 8, label: '排水処理棟 調整ﾎﾟﾝﾌﾟ1号' },
    { col: 'Q', tag: 'tag05', kwIndex: 9, label: '排水処理棟 調整ﾎﾟﾝﾌﾟ2号' },
    { col: 'R', tag: 'tag05', kwIndex: 10, label: '排水処理棟 暖気ﾌﾞﾛｱ1号' },
    { col: 'S', tag: 'tag05', kwIndex: 11, label: '排水処理棟 暖気ﾌﾞﾛｱ2号' },
    { col: 'T', tag: 'tag05', kwIndex: 12, label: '排水処理棟 流量調整槽ﾌﾞﾛｱ' },
    { col: 'U', tag: 'tag05', kwIndex: 13, label: '排水処理棟 沈殿槽分配ﾎﾟﾝﾌﾟ1号' },
    { col: 'V', tag: 'tag05', kwIndex: 14, label: '排水処理棟 沈殿槽分配ﾎﾟﾝﾌﾟ2号' },
    { col: 'W', tag: 'tag05', kwIndex: 15, label: '純水装置1号盤 井戸ﾎﾟﾝﾌﾟA' },
    { col: 'X', tag: 'tag05', kwIndex: 16, label: '純水装置1号盤 井戸ﾎﾟﾝﾌﾟB' },
    { col: 'Y', tag: 'tag05', kwIndex: 17, label: '純水装置1号盤 ろ過原水ﾎﾟﾝﾌﾟ' },
    { col: 'Z', tag: 'tag05', kwIndex: 18, label: '純水装置1号盤 中継ﾎﾟﾝﾌﾟ' },
    { col: 'AA', tag: 'tag05', kwIndex: 19, label: '純水装置1号盤 原水送水ﾎﾟﾝﾌﾟ' },
    { col: 'AB', tag: 'tag05', kwIndex: 20, label: '純水装置1号盤 純水送水ﾎﾟﾝﾌﾟ' },
    { col: 'AC', tag: 'tag05', kwIndex: 21, label: '純水装置1号盤 上水低圧ﾎﾟﾝﾌﾟ' },
    { col: 'AD', tag: 'tag05', kwIndex: 22, label: '純水装置1号盤 ﾊﾟｽﾄﾗﾎﾟﾝﾌﾟ' },
    { col: 'AE', tag: 'tag05', kwIndex: 23, label: '純水装置1号盤 駆動水ﾎﾟﾝﾌﾟ' },
    { col: 'AF', tag: 'tag05', kwIndex: 24, label: '純水装置1号盤 UV殺菌器' },
    { col: 'AG', tag: 'tag05', kwIndex: 25, label: '純水装置2号盤 2号中継ﾎﾟﾝﾌﾟゴウ' },
    { col: 'AH', tag: 'tag05', kwIndex: 26, label: '純水装置2号盤 2号ろ過原水ﾎﾟﾝﾌﾟ' },
    { col: 'AI', tag: 'tag05', kwIndex: 27, label: '純水装置2号盤 2号駆動水ﾎﾟﾝﾌﾟ' },

    // tag06 (1110-1209: 45列)
    { col: 'AJ', tag: 'tag06', kwIndex: 0, label: '屋上 屋上室外機' },
    { col: 'AK', tag: 'tag06', kwIndex: 1, label: '屋上 ﾁﾗｰ' },
    { col: 'AL', tag: 'tag06', kwIndex: 2, label: '屋上 屋上室外機ACP-C' },
    { col: 'AM', tag: 'tag06', kwIndex: 3, label: '屋上 屋上冷水2次ﾎﾟﾝﾌﾟ(生産用)' },
    { col: 'AN', tag: 'tag06', kwIndex: 4, label: '抽出室 ﾙｰﾂﾌﾞﾛｱ' },
    { col: 'AO', tag: 'tag06', kwIndex: 5, label: '抽出室 ﾛｰﾀﾘｰﾊﾞﾙﾌﾞ' },
    { col: 'AP', tag: 'tag06', kwIndex: 6, label: '抽出室 粕搬送ｺﾝﾍﾞｱ抽出器下' },
    { col: 'AQ', tag: 'tag06', kwIndex: 7, label: '抽出室 粕搬送ｺﾝﾍﾞｱ合流CV' },
    { col: 'AR', tag: 'tag06', kwIndex: 8, label: '抽出室 粕搬送CV(ﾆｰﾀﾞｰ用)' },
    { col: 'AS', tag: 'tag06', kwIndex: 9, label: '抽出室 屋外振分ｽｸﾘｭｰ' },
    { col: 'AT', tag: 'tag06', kwIndex: 10, label: '2F 低圧電灯盤 №1 1LM-A' },
    { col: 'AU', tag: 'tag06', kwIndex: 11, label: '2F 低圧電灯盤 №1 1LM-B' },
    { col: 'AV', tag: 'tag06', kwIndex: 12, label: '2F 低圧電灯盤 №1 2LM-A' },
    { col: 'AW', tag: 'tag06', kwIndex: 13, label: '2F 低圧電灯盤 №1 2LM-B' },
    { col: 'AX', tag: 'tag06', kwIndex: 14, label: '2F 低圧電灯盤 №1 2LM-C' },
    { col: 'AY', tag: 'tag06', kwIndex: 15, label: '2F 低圧電灯盤 №1 ｹﾞｰﾄﾊｳｽ' },
    { col: 'AZ', tag: 'tag06', kwIndex: 16, label: '2F 低圧電灯盤 №1 8.20.18E包装制御盤' },
    { col: 'BA', tag: 'tag06', kwIndex: 17, label: '2F 低圧電灯盤 №1 排水処理制御盤' },
    { col: 'BB', tag: 'tag06', kwIndex: 18, label: '2F 低圧電灯盤 №1 1LM-C' },
    { col: 'BC', tag: 'tag06', kwIndex: 19, label: '2F 低圧電灯盤 №1 ﾎﾞｲﾗ-室ｺﾝﾌﾟﾚｯｻｰ室電灯' },
    { col: 'BD', tag: 'tag06', kwIndex: 20, label: '2F 低圧動力盤 №3 2M-A' },
    { col: 'BE', tag: 'tag06', kwIndex: 21, label: '2F 低圧動力盤 №3 冷蔵倉庫' },
    { col: 'BF', tag: 'tag06', kwIndex: 22, label: '2F 低圧動力盤 №3 包装制御盤' },
    { col: 'BG', tag: 'tag06', kwIndex: 23, label: '2F 低圧動力盤 №3 1LM-A' },
    { col: 'BH', tag: 'tag06', kwIndex: 24, label: '2F 低圧動力盤 №3 2LM-A' },
    { col: 'BI', tag: 'tag06', kwIndex: 25, label: '2F 低圧動力盤 №3 2LM-B' },
    { col: 'BJ', tag: 'tag06', kwIndex: 26, label: '2F 低圧動力盤 №3 1M-C' },
    { col: 'BK', tag: 'tag06', kwIndex: 27, label: '2F 低圧動力盤 №3 調合CIP' },
    { col: 'BL', tag: 'tag06', kwIndex: 28, label: '2F 低圧動力盤 №3 ﾎﾞﾄﾙ開梱室AC.ｷｬｯﾌﾟ室AC' },
    { col: 'BM', tag: 'tag06', kwIndex: 29, label: '2F 低圧動力盤 №3 1LM-B' },
    { col: 'BN', tag: 'tag06', kwIndex: 30, label: '2F 低圧動力盤 №3 2LM-C' },
    { col: 'BO', tag: 'tag06', kwIndex: 31, label: '2F 低圧動力盤 №3 ｹﾞｰﾄﾊｳｽ' },
    { col: 'BP', tag: 'tag06', kwIndex: 32, label: '2F 低圧動力盤 №4 ｼｰﾄ供給.ｹｰｽｺﾍﾞｱ.ﾊﾟﾚﾀｲｻﾞｰ' },
    { col: 'BQ', tag: 'tag06', kwIndex: 33, label: '2F 低圧動力盤 №4 13E.31-3' },
    { col: 'BR', tag: 'tag06', kwIndex: 34, label: '2F 低圧動力盤 №4 実瓶ｺﾝﾍﾞｱ振分装置' },
    { col: 'BS', tag: 'tag06', kwIndex: 35, label: '2F 低圧動力盤 №4 ｹｰｻｰ制御盤' },
    { col: 'BT', tag: 'tag06', kwIndex: 36, label: '2F 低圧動力盤 №4 分電盤(1)' },
    { col: 'BU', tag: 'tag06', kwIndex: 37, label: '2F 低圧動力盤 №4 15-1' },
    { col: 'BV', tag: 'tag06', kwIndex: 38, label: '2F 低圧動力盤 №4 充填ﾊﾟﾈﾙ' },
    { col: 'BW', tag: 'tag06', kwIndex: 39, label: '2F 低圧動力盤 №4 空ﾊﾟﾚｯﾄ搬送' },
    { col: 'BX', tag: 'tag06', kwIndex: 40, label: '2F 低圧動力盤 №4 ﾌｨﾗ給液制御盤' },
    { col: 'BY', tag: 'tag06', kwIndex: 41, label: '2F 低圧動力盤 №4 分電盤(2)' },
    { col: 'BZ', tag: 'tag06', kwIndex: 42, label: '2F 低圧動力盤 №4 2E.3Eﾊﾞﾙｸﾃﾞﾊﾟﾚﾀｲｻﾞｰ' },
    { col: 'CA', tag: 'tag06', kwIndex: 43, label: '2F 低圧動力盤 №4 CIPパネル' },
    { col: 'CB', tag: null, fixedVal: 0.0, label: '2F 低圧動力盤 №5 HGINV' },

    // tag07 (1210-1236: 13列)
    { col: 'CC', tag: 'tag07', kwIndex: 0, label: '2F 低圧動力盤 №5 抽出ﾊﾟﾈﾙ.抽出工程ﾊﾟﾈﾙ' },
    { col: 'CD', tag: 'tag07', kwIndex: 1, label: '2F 低圧動力盤 №5 1LM-C' },
    { col: 'CE', tag: 'tag07', kwIndex: 2, label: '2F 低圧動力盤 №5 29-1' },
    { col: 'CF', tag: 'tag07', kwIndex: 3, label: '2F 低圧動力盤 №5 36.39' },
    { col: 'CG', tag: 'tag07', kwIndex: 4, label: '2F 低圧動力盤 №5 殺菌制御盤' },
    { col: 'CH', tag: 'tag07', kwIndex: 5, label: '2F 低圧動力盤 №5 ｸﾗﾘ動力(PET・CUP)' },
    { col: 'CI', tag: 'tag07', kwIndex: 6, label: '2F 低圧動力盤 №5 調合ﾀﾝｸﾊﾟﾈﾙ' },
    { col: 'CJ', tag: 'tag07', kwIndex: 7, label: '2F 低圧動力盤 №5 ｽﾄﾚｰｼﾞ温水ﾊﾟﾈﾙ' },
    { col: 'CK', tag: 'tag07', kwIndex: 8, label: '2F 低圧動力盤 №5 ﾆｰﾀﾞｰ.抽出工程ﾊﾟﾈﾙ' },
    { col: 'CL', tag: 'tag07', kwIndex: 9, label: '2F 低圧動力盤 №5 新1真空ﾎﾟﾝﾌﾟﾗﾍﾞﾗｰ制御盤' },
    { col: 'CM', tag: 'tag07', kwIndex: 10, label: '2F 低圧動力盤 №5 定置式発泡洗浄装置制御盤' },
    { col: 'CN', tag: 'tag07', kwIndex: 11, label: '2F 低圧動力盤 №5 空ﾎﾞﾄﾙ制御盤' },
    { col: 'CO', tag: 'tag07', kwIndex: 12, label: '2F 低圧動力盤 №5 ﾘﾝｻ・ﾌｨﾗ・ｷｬｯﾊﾟ制御盤' }
  ];

  // グラフ目盛りスケール設定 (初期マスター定義)
  const SCALE_CONFIG = {
    mode: 'auto', // 'auto' (自動最適化) または 'fixed' (固定値指定)
    // 自動算出時、データの最大値を軸の高さのどのあたりに置くか (0〜1)。小さくするほど上の余白が広がる
    autoLayout: {
      rateBarPeakRatio: 0.6,  // 原単位グラフ: 品種別の棒の最大 (折れ線と重ならないよう低めに置く)
      rateLinePeakRatio: 0.9, // 原単位グラフ: 全体平均の折れ線の最大
      trendPeakRatio: 0.9     // トレンドグラフ (総量系): 品種別の線の最大
    },
    fixedValues: {
      daily: {
        totalKwh: 30000 // 単月詳細: 日別総電力量 [kWh]
      },
      annualEquipment: {
        totalKwh: 600000 // 年間設備別: 月別総電力量 [kWh]
      },
      annualVariety: {
        powerKwh: 600000,           // 1. 電力量 [kWh]
        operationMin: 50000,        // 2. 操業時間 [分] (2024年7月度4.2万分実績対応)
        productionBottles: 15000000, // 3. 生産本数 [本] (2024年7月度1,194万本実績対応)
        powerCostYen: 15000000,     // 4. 電力コスト [円]
        kwhPerBottle: 0.12,         // 5. 単位本電力量 [kWh/本]
        kwhPerMinute: 25.0,         // 6. 単位時間電力量 [kWh/分]
        costPerBottle: 3.0,         // 7. 単位本コスト [円/本]
        costPerMinute: 600.0        // 8. 単位時間コスト [円/分]
      }
    }
  };

  /**
   * 年度の一覧を、連続する年度をまとめた文字列にする (例: [2013, 2014, 2015, 2018] → '2013〜2015、2018')
   */
  function formatFiscalYearRanges(years) {
    const sorted = Array.from(new Set((years || []).map(Number))).sort((a, b) => a - b);
    const parts = [];
    let start = null;
    let prev = null;
    sorted.forEach(y => {
      if (start === null) {
        start = y;
      } else if (y !== prev + 1) {
        parts.push(start === prev ? String(start) : `${start}〜${prev}`);
        start = y;
      }
      prev = y;
    });
    if (start !== null) parts.push(start === prev ? String(start) : `${start}〜${prev}`);
    return parts.join('、');
  }

  return {
    VARIETY_MASTER,
    VARIETY_GROUPS,
    VARIETY_KEYS,
    VARIETY_MAPPING,
    EVALUATION_METRICS,
    FUEL_METRICS,
    TOTAL_ENERGY_SOURCES,
    TOTAL_ENERGY_SHEET_COLUMNS,
    RATE_METRIC_KEYS,
    FISCAL_MONTH_ORDER,
    FISCAL_MONTH_LABELS,
    getFiscalYear,
    formatFiscalYearRanges,
    STEP_MASTER,
    CATEGORIES,
    CATEGORY_COLUMN_MAP,
    EQUIPMENT_COLUMNS,
    SCALE_CONFIG
  };

}));

