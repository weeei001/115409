import os
import re
import pandas as pd
from news_storage import NewsStorageManager
from adapters.yahoo_adapter import YahooAdapter

# 6 檔目標台股的代號 + 別名（公司名）。比對順序：代號 → 任一別名。
# 命中第一檔即回傳，避免一篇談台積電供應鏈的新聞被歸到鴻海。
TARGET_STOCKS_ALIASES = [
    ("2330", ["台積電", "台積", "TSMC"]),
    ("2317", ["鴻海", "Foxconn", "富士康"]),
    ("2454", ["聯發科", "MediaTek"]),
    ("2881", ["富邦金", "富邦金控"]),
    ("2408", ["南亞科"]),
    ("2615", ["萬海"]),
]


def extract_stock_id(*texts):
    """從任意數量的文字片段（標題、標籤、內文…）判定股票代號。
    命中白名單回傳代號，否則 'tw_stock'。
    """
    haystack = " ".join(t for t in texts if t)
    for code, aliases in TARGET_STOCKS_ALIASES:
        if code in haystack:
            return code
        for name in aliases:
            if name in haystack:
                return code
    return "tw_stock"

def ingest_csv_data(db_manager, csv_dir):
    """將現有的 crawler/*.csv 資料存入本機資料庫"""
    print(f"Ingesting CSV data from {csv_dir}...")
    for filename in os.listdir(csv_dir):
        if filename.endswith("_news_cleaned.csv"): # 優先使用清洗過的資料
            stock_id = filename.split('_')[0]
            file_path = os.path.join(csv_dir, filename)
            # 讀取 CSV 並映射中文欄位
            df = pd.read_csv(file_path)
            
            # 定義欄位映射
            col_map = {
                '標題': 'title',
                '發布時間': 'pub_time',
                '內文': 'content',
                '連結': 'url',
                '來源': 'source_site'
            }
            
            count = 0
            for _, row in df.iterrows():
                # 取得資料，優先使用映射後的欄位，若無則用預設值
                title = row.get('標題', row.get('title', 'No Title'))
                content = row.get('內文', row.get('content', ''))
                pub_time = row.get('發布時間', row.get('pub_time', '2024-01-01 00:00:00'))
                url = row.get('連結', row.get('url', ''))
                source_site = row.get('來源', row.get('source', 'crawler_csv'))
                tags = str(row.get('標籤', row.get('tags', '')))
                if tags == 'nan':
                    tags = ''

                success, _ = db_manager.add_news(
                    source=source_site,
                    stock_id=stock_id,
                    title=title,
                    content=content,
                    pub_time=pub_time,
                    url=url,
                    tags=tags
                )
                if success: count += 1
            print(f"  - {stock_id}: Added {count} new items.")

def ingest_other_web_data(db_manager, base_path):
    """掃描 OtherNewWeb 底下的各家媒體資料"""
    # 處理各個新聞來源資料夾
    news_sources = {
        'cnyes': 'cnyes_news.csv',
        'moneydj': 'moneydj_news.csv',
        'ltn': 'ltn_news_cleaned.csv',
        'udn': 'udn_news.csv',
        'chinatimes': 'chinatimes_news.csv',
        'yahoo': 'yahoo_news.csv'
    }

    print(f"Scanning OtherNewWeb at {base_path}...")
    for source_name, csv_filename in news_sources.items():
        source_path = os.path.join(base_path, source_name, csv_filename)

        if not os.path.exists(source_path):
            print(f"  - {source_name}: Not found")
            continue

        try:
            df = pd.read_csv(source_path, encoding='utf-8-sig')
            count = 0

            for _, row in df.iterrows():
                # 提取資料
                title = row.get('標題', '').strip()
                content = row.get('內文', '').strip()
                pub_time = row.get('發布時間', '2024-01-01 00:00:00')
                url = row.get('連結', '')
                tags = str(row.get('標籤', ''))

                # 用白名單比對標題 + 標籤 + 內文前段
                stock_id = extract_stock_id(title, tags, content[:1000])

                # 標題為空則跳過
                if not title:
                    continue

                success, _ = db_manager.add_news(
                    source=source_name,
                    stock_id=stock_id,
                    title=title,
                    content=content,
                    pub_time=pub_time,
                    url=url
                )
                if success:
                    count += 1

            print(f"  - {source_name}: Added {count} new items.")

        except Exception as e:
            print(f"  - {source_name}: Error - {e}")

if __name__ == "__main__":
    import sys
    ltn_only = "--ltn-only" in sys.argv

    db = NewsStorageManager()

    if ltn_only:
        # 只處理 LTN
        other_web_folder = "OtherNewWeb/News_Crawler-master/NewsDB"
        ltn_path = os.path.join(other_web_folder, "ltn", "ltn_news_cleaned.csv")
        if os.path.exists(ltn_path):
            df = pd.read_csv(ltn_path, encoding='utf-8-sig')
            count = 0
            for _, row in df.iterrows():
                title = row.get('標題', '').strip()
                content = row.get('內文', '').strip()
                if not title:
                    continue
                success, _ = db.add_news(
                    source='ltn',
                    stock_id=extract_stock_id(title, content[:1000]),
                    title=title,
                    content=content,
                    pub_time=row.get('發布時間', '2024-01-01 00:00:00'),
                    url=row.get('連結', '')
                )
                if success:
                    count += 1
            print(f"LTN: Added {count} new items.")
        else:
            print(f"找不到 {ltn_path}")
    else:
        # 1. 處理現有的 CSV 資料
        csv_folder = "crawler"
        if os.path.exists(csv_folder):
            ingest_csv_data(db, csv_folder)

        # 2. 處理 OtherNewWeb 資料
        other_web_folder = "OtherNewWeb/News_Crawler-master/NewsDB"
        if os.path.exists(other_web_folder):
            ingest_other_web_data(db, other_web_folder)

    print("\nLocal Database Status:")
    print(f"Total News Count: {db.index['stats']['total_count']}")
    for source, count in db.index['stats']['sources'].items():
        print(f"  - {source}: {count}")
