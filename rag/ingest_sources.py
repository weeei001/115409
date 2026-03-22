import os
import pandas as pd
from news_storage import NewsStorageManager
from adapters.yahoo_adapter import YahooAdapter

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
    import re

    def extract_stock_from_title_or_tags(title, tags):
        """從標題或標籤中提取股票代號，找不到則回傳 'tw_stock'"""
        text = f"{title} {tags}"
        # 比對 4 位數股票代號（如 2330、0050 等）
        match = re.search(r'\b([0-9]{4,5}[A-Z]?)\b', text)
        if match:
            return match.group(1)
        return "tw_stock"

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

                # 從標題或標籤中提取股票代號，找不到則用 tw_stock
                stock_id = extract_stock_from_title_or_tags(title, tags)

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
            import re
            def extract_stock(title):
                match = re.search(r'\b([0-9]{4,5}[A-Z]?)\b', title)
                return match.group(1) if match else "tw_stock"

            df = pd.read_csv(ltn_path, encoding='utf-8-sig')
            count = 0
            for _, row in df.iterrows():
                title = row.get('標題', '').strip()
                content = row.get('內文', '').strip()
                if not title:
                    continue
                success, _ = db.add_news(
                    source='ltn',
                    stock_id=extract_stock(title),
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
