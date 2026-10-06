/**
 * gas_app/Config.gs
 * エネルギー使用量集計システム GAS設定およびマスター定義
 */

var CONFIG = {
  // 対象スプレッドシートID
  // 同一スプレッドシートのコンテナバインドスクリプトの場合は空文字 '' のままで自動認識されます。
  // スタンドアロンスクリプトの場合は対象スプレッドシートのID（URLの /d/ と /edit の間の文字列）を設定してください。
  SPREADSHEET_ID: '',

  // シート名定義
  SHEET_NAMES: {
    HOURLY: '1時間集計(ALL)',
    DAILY: '日別集約',
    MONTHLY: '月別集約',
    VARIETY: '品種別集約',
    KPI: 'KPI評価',
    MASTER: 'マスター'
  },

  // 品種8大分類キー
  VARIETY_KEYS: ['2.0L', '1.5L', '1.0L', '600mL丸', '500mL丸', '500mL角', '350mL', '280mL'],

  /**
   * 品種合算マッピング設定
   * 8大分類キーに対して、月報Excel（月報PET）内のどの品種を紐付けて合算するかを定義します。
   * 新しい品種の追加や合算ルールの変更は、以下の配列にキーワード（または品種名）を追加・変更してください。
   * ※全角・半角（500ml / 500ｍｌ / 500mL）や大文字小文字は自動で正規化されます。
   */
  VARIETY_MAPPING: {
    '2.0L': ['2.0L', '2L'],
    '1.5L': ['1.5L'],
    '1.0L': ['1.0L長角', '1.0L正角', '1.0L', '1L'],
    '600mL丸': ['600mL丸', '600ml丸'],
    '500mL丸': ['500mL丸', '500ml丸', '550mL丸', '550ml丸'], // 500ml丸と550ml丸を合算
    '500mL角': ['500mL角', '500ml角'],
    '350mL': ['350mL', '350ml'],
    '280mL': ['280mL', '280ml']
  },

  // カテゴリ一覧
  CATEGORIES: [
    { key: 'total', name: '総電力' },
    { key: 'utility', name: 'ユーティリティ' },
    { key: 'compressor', name: 'コンプレッサー' },
    { key: 'boiler', name: 'ボイラー' },
    { key: 'pureWater', name: '純水装置' },
    { key: 'drainWater', name: '排水処理' },
    { key: 'chiller', name: 'チラー' },
    { key: 'mixing', name: '調合抽出' },
    { key: 'supply', name: '供給' },
    { key: 'filling', name: '充填' },
    { key: 'packaging', name: '包装' }
  ],

  // 1時間集計シートのヘッダーカラムリスト (90列)
  COLUMNS: [
    { col: 'D', label: 'コンプレッサー No1' },
    { col: 'E', label: 'コンプレッサー No2' },
    { col: 'F', label: 'コンプレッサー No3' },
    { col: 'G', label: '1F 低圧動力盤 №1 AMPAC' },
    { col: 'H', label: '1F 低圧動力盤 №2 ｺﾝﾌﾟﾚｯｻｰ制御盤' },
    { col: 'I', label: '井水純水制御盤' },
    { col: 'J', label: '排水処理制御盤' },
    { col: 'K', label: 'ﾎﾞｲﾗｰ制御盤' },
    { col: 'L', label: 'ｶｯﾌﾟ殺菌制御盤' },
    { col: 'M', label: '消火ﾎﾟﾝﾌﾟ盤' },
    { col: 'N', label: '排水処理棟 原水ﾎﾟﾝﾌﾟ1号' },
    { col: 'O', label: '排水処理棟 原水ﾎﾟﾝﾌﾟ2号' },
    { col: 'P', label: '排水処理棟 調整ﾎﾟﾝﾌﾟ1号' },
    { col: 'Q', label: '排水処理棟 調整ﾎﾟﾝﾌﾟ2号' },
    { col: 'R', label: '排水処理棟 暖気ﾌﾞﾛｱ1号' },
    { col: 'S', label: '排水処理棟 暖気ﾌﾞﾛｱ2号' },
    { col: 'T', label: '排水処理棟 流量調整槽ﾌﾞﾛｱ' },
    { col: 'U', label: '排水処理棟 沈殿槽分配ﾎﾟﾝﾌﾟ1号' },
    { col: 'V', label: '排水処理棟 沈殿槽分配ﾎﾟﾝﾌﾟ2号' },
    { col: 'W', label: '純水装置1号盤 井戸ﾎﾟﾝﾌﾟA' },
    { col: 'X', label: '純水装置1号盤 井戸ﾎﾟﾝﾌﾟB' },
    { col: 'Y', label: '純水装置1号盤 ろ過原水ﾎﾟﾝﾌﾟ' },
    { col: 'Z', label: '純水装置1号盤 中継ﾎﾟﾝﾌﾟ' },
    { col: 'AA', label: '純水装置1号盤 原水送水ﾎﾟﾝﾌﾟ' },
    { col: 'AB', label: '純水装置1号盤 純水送水ﾎﾟﾝﾌﾟ' },
    { col: 'AC', label: '純水装置1号盤 上水低圧ﾎﾟﾝﾌﾟ' },
    { col: 'AD', label: '純水装置1号盤 ﾊﾟｽﾄﾗﾎﾟﾝﾌﾟ' },
    { col: 'AE', label: '純水装置1号盤 駆動水ﾎﾟﾝﾌﾟ' },
    { col: 'AF', label: '純水装置1号盤 UV殺菌器' },
    { col: 'AG', label: '純水装置2号盤 2号中継ﾎﾟﾝﾌﾟゴウ' },
    { col: 'AH', label: '純水装置2号盤 2号ろ過原水ﾎﾟﾝﾌﾟ' },
    { col: 'AI', label: '純水装置2号盤 2号駆動水ﾎﾟﾝﾌﾟ' },
    { col: 'AJ', label: '屋上 屋上室外機' },
    { col: 'AK', label: '屋上 ﾁﾗｰ' },
    { col: 'AL', label: '屋上 屋上室外機ACP-C' },
    { col: 'AM', label: '屋上 屋上冷水2次ﾎﾟﾝﾌﾟ(生産用)' },
    { col: 'AN', label: '抽出室 ﾙｰﾂﾌﾞﾛｱ' },
    { col: 'AO', label: '抽出室 ﾛｰﾀﾘｰﾊﾞﾙﾌﾞ' },
    { col: 'AP', label: '抽出室 粕搬送ｺﾝﾍﾞｱ抽出器下' },
    { col: 'AQ', label: '抽出室 粕搬送ｺﾝﾍﾞｱ合流CV' },
    { col: 'AR', label: '抽出室 粕搬送CV(ﾆｰﾀﾞｰ用)' },
    { col: 'AS', label: '抽出室 屋外振分ｽｸﾘｭｰ' },
    { col: 'AT', label: '2F 低圧電灯盤 №1 1LM-A' },
    { col: 'AU', label: '2F 低圧電灯盤 №1 1LM-B' },
    { col: 'AV', label: '2F 低圧電灯盤 №1 2LM-A' },
    { col: 'AW', label: '2F 低圧電灯盤 №1 2LM-B' },
    { col: 'AX', label: '2F 低圧電灯盤 №1 2LM-C' },
    { col: 'AY', label: '2F 低圧電灯盤 №1 ｹﾞｰﾄﾊｳｽ' },
    { col: 'AZ', label: '2F 低圧電灯盤 №1 8.20.18E包装制御盤' },
    { col: 'BA', label: '2F 低圧電灯盤 №1 排水処理制御盤' },
    { col: 'BB', label: '2F 低圧電灯盤 №1 1LM-C' },
    { col: 'BC', label: '2F 低圧電灯盤 №1 ﾎﾞｲﾗ-室ｺﾝﾌﾟﾚｯｻｰ室電灯' },
    { col: 'BD', label: '2F 低圧動力盤 №3 2M-A' },
    { col: 'BE', label: '2F 低圧動力盤 №3 冷蔵倉庫' },
    { col: 'BF', label: '2F 低圧動力盤 №3 包装制御盤' },
    { col: 'BG', label: '2F 低圧動力盤 №3 1LM-A' },
    { col: 'BH', label: '2F 低圧動力盤 №3 2LM-A' },
    { col: 'BI', label: '2F 低圧動力盤 №3 2LM-B' },
    { col: 'BJ', label: '2F 低圧動力盤 №3 1M-C' },
    { col: 'BK', label: '2F 低圧動力盤 №3 調合CIP' },
    { col: 'BL', label: '2F 低圧動力盤 №3 ﾎﾞﾄﾙ開梱室AC.ｷｬｯﾌﾟ室AC' },
    { col: 'BM', label: '2F 低圧動力盤 №3 1LM-B' },
    { col: 'BN', label: '2F 低圧動力盤 №3 2LM-C' },
    { col: 'BO', label: '2F 低圧動力盤 №3 ｹﾞｰﾄﾊｳｽ' },
    { col: 'BP', label: '2F 低圧動力盤 №4 ｼｰﾄ供給.ｹｰｽｺﾍﾞｱ.ﾊﾟﾚﾀｲｻﾞｰ' },
    { col: 'BQ', label: '2F 低圧動力盤 №4 13E.31-3' },
    { col: 'BR', label: '2F 低圧動力盤 №4 実瓶ｺﾝﾍﾞｱ振分装置' },
    { col: 'BS', label: '2F 低圧動力盤 №4 ｹｰｻｰ制御盤' },
    { col: 'BT', label: '2F 低圧動力盤 №4 分電盤(1)' },
    { col: 'BU', label: '2F 低圧動力盤 №4 15-1' },
    { col: 'BV', label: '2F 低圧動力盤 №4 充填ﾊﾟﾈﾙ' },
    { col: 'BW', label: '2F 低圧動力盤 №4 空ﾊﾟﾚｯﾄ搬送' },
    { col: 'BX', label: '2F 低圧動力盤 №4 ﾌｨﾗ給液制御盤' },
    { col: 'BY', label: '2F 低圧動力盤 №4 分電盤(2)' },
    { col: 'BZ', label: '2F 低圧動力盤 №4 2E.3Eﾊﾞﾙｸﾃﾞﾊﾟﾚﾀｲｻﾞｰ' },
    { col: 'CA', label: '2F 低圧動力盤 №4 CIPパネル' },
    { col: 'CB', label: '2F 低圧動力盤 №5 HGINV' },
    { col: 'CC', label: '2F 低圧動力盤 №5 抽出ﾊﾟﾈﾙ.抽出工程ﾊﾟﾈﾙ' },
    { col: 'CD', label: '2F 低圧動力盤 №5 1LM-C' },
    { col: 'CE', label: '2F 低圧動力盤 №5 29-1' },
    { col: 'CF', label: '2F 低圧動力盤 №5 36.39' },
    { col: 'CG', label: '2F 低圧動力盤 №5 殺菌制御盤' },
    { col: 'CH', label: '2F 低圧動力盤 №5 ｸﾗﾘ動力(PET・CUP)' },
    { col: 'CI', label: '2F 低圧動力盤 №5 調合ﾀﾝｸﾊﾟﾈﾙ' },
    { col: 'CJ', label: '2F 低圧動力盤 №5 ｽﾄﾚｰｼﾞ温水ﾊﾟﾈﾙ' },
    { col: 'CK', label: '2F 低圧動力盤 №5 ﾆｰﾀﾞｰ.抽出工程ﾊﾟﾈﾙ' },
    { col: 'CL', label: '2F 低圧動力盤 №5 新1真空ﾎﾟﾝﾌﾟﾗﾍﾞﾗｰ制御盤' },
    { col: 'CM', label: '2F 低圧動力盤 №5 定置式発泡洗浄装置制御盤' },
    { col: 'CN', label: '2F 低圧動力盤 №5 空ﾎﾞﾄﾙ制御盤' },
    { col: 'CO', label: '2F 低圧動力盤 №5 ﾘﾝｻ・ﾌｨﾗ・ｷｬｯﾊﾟ制御盤' }
  ],

  // グラフ目盛りスケール設定 (初期マスター定義)
  SCALE_CONFIG: {
    mode: 'auto', // 'auto' (自動最適化) または 'fixed' (固定値指定)
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
  }
};

/**
 * 設定オブジェクトを取得する
 */
function getConfig() {
  return CONFIG;
}
