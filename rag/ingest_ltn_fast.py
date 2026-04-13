"""
LTN 快速 ingest 腳本
- 用 set 去重（O(1) 查找，取代 O(n) 線性掃描）
- 批次寫入 index.json（取代每篇寫一次）
- 進度顯示
"""
import json
import os
import hashlib
import re
import pandas as pd

DB_ROOT = "news_db_local"
INDEX_PATH = os.path.join(DB_ROOT, "index.json")
LTN_CSV = "OtherNewWeb/News_Crawler-master/NewsDB/ltn/ltn_news_cleaned.csv"
CONTENT_DIR = os.path.join(DB_ROOT, "ltn", "content")
BATCH_SIZE = 1000  # 每 1000 篇寫一次 index.json

STOCK_NAMES = {
    "2330": ["台積電", "TSMC"],
    "2317": ["鴻海", "富士康"],
    "2454": ["聯發科", "MediaTek"],
    "2881": ["富邦金", "富邦"],
    "2408": ["南亞科", "南亞"],
    "2615": ["萬海"],
}

def extract_stock_id(title):
    # 先比對股票代號
    m = re.search(r'\b(2330|2317|2454|2881|2408|2615)\b', title)
    if m:
        return m.group(1)
    # 再比對公司名稱
    for sid, names in STOCK_NAMES.items():
        for name in names:
            if name in title:
                return sid
    # 4-5位數字
    m = re.search(r'\b([0-9]{4,5}[A-Z]?)\b', title)
    if m:
        return m.group(1)
    return "tw_stock"

def main():
    os.makedirs(CONTENT_DIR, exist_ok=True)

    # 載入現有 index
    if os.path.exists(INDEX_PATH):
        try:
            with open(INDEX_PATH, 'r', encoding='utf-8') as f:
                index = json.load(f)
            print(f"載入現有 index: {index['stats']['total_count']:,} 篇")
        except Exception:
            print("index.json 損壞，重新建立")
            index = {"news": [], "stats": {"total_count": 0, "sources": {}}}
    else:
        index = {"news": [], "stats": {"total_count": 0, "sources": {}}}

    # 建立已存在的 article_id set（O(1) 去重）
    existing_ids = set(item['article_id'] for item in index['news'])
    print(f"已有 {len(existing_ids):,} 篇（去重用）")

    # 讀取 LTN CSV
    print(f"讀取 {LTN_CSV}...")
    df = pd.read_csv(LTN_CSV, encoding='utf-8-sig')
    total = len(df)
    print(f"LTN 文章數: {total:,}")

    added = 0
    skipped = 0

    for i, (_, row) in enumerate(df.iterrows()):
        title = str(row.get('標題', '')).strip()
        content = str(row.get('內文', '')).strip()
        pub_time = str(row.get('發布時間', '2024-01-01 00:00:00'))
        url = str(row.get('連結', ''))

        if not title or len(content) < 30:
            skipped += 1
            continue

        article_id = hashlib.md5(f"ltn_{title}_{pub_time}".encode()).hexdigest()

        if article_id in existing_ids:
            skipped += 1
            continue

        # 寫入 content 檔
        with open(os.path.join(CONTENT_DIR, f"{article_id}.txt"), 'w', encoding='utf-8') as f:
            f.write(content)

        # 加入 index
        stock_id = extract_stock_id(title)
        index['news'].append({
            "article_id": article_id,
            "source": "ltn",
            "source_group": "ltn",
            "stock_id": stock_id,
            "title": title,
            "pub_time": pub_time,
            "url": url,
            "tags": "",
            "content_file": f"ltn/content/{article_id}.txt"
        })
        existing_ids.add(article_id)
        index['stats']['total_count'] += 1
        index['stats']['sources']['ltn'] = index['stats']['sources'].get('ltn', 0) + 1
        added += 1

        # 每 BATCH_SIZE 篇寫一次
        if added % BATCH_SIZE == 0:
            with open(INDEX_PATH, 'w', encoding='utf-8') as f:
                json.dump(index, f, ensure_ascii=False)
            pct = (i + 1) / total * 100
            print(f"  進度: {i+1:,}/{total:,} ({pct:.1f}%) | 新增: {added:,} | 跳過: {skipped:,}")

    # 最後寫入
    with open(INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False)

    print(f"\n✅ 完成！新增 {added:,} 篇，跳過 {skipped:,} 篇")
    print(f"   總計: {index['stats']['total_count']:,} 篇")
    for src, cnt in index['stats']['sources'].items():
        print(f"   {src}: {cnt:,}")

if __name__ == "__main__":
    main()
