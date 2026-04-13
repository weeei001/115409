"""
LTN 自由時報新聞清洗腳本
- 移除底部導覽/廣告雜訊
- 移除記者署名/圖片說明
- 去除重複 URL
- 過濾無效短文章
- 備份原檔，輸出 ltn_news_cleaned.csv
"""

import pandas as pd
import os
import shutil
from clean_news import clean_ltn_news_text

LTN_CSV = "OtherNewWeb/News_Crawler-master/NewsDB/ltn/ltn_news.csv"
OUTPUT_CSV = "OtherNewWeb/News_Crawler-master/NewsDB/ltn/ltn_news_cleaned.csv"
BACKUP_CSV = "OtherNewWeb/News_Crawler-master/NewsDB/ltn/ltn_news_backup.csv"

def main():
    if not os.path.exists(LTN_CSV):
        print(f"找不到 {LTN_CSV}")
        return

    print(f"讀取 {LTN_CSV}...")
    df = pd.read_csv(LTN_CSV, encoding='utf-8-sig')
    total_raw = len(df)
    print(f"原始資料: {total_raw:,} 筆")

    # 1. 基礎過濾
    df = df.dropna(subset=['內文', '標題'])
    df = df[df['內文'].str.strip().str.len() > 30]
    df = df[df['標題'].str.strip().str.len() > 3]
    print(f"基礎過濾後: {len(df):,} 筆（移除 {total_raw - len(df):,} 筆）")

    # 2. 移除重複 URL
    before = len(df)
    df = df.drop_duplicates(subset=['連結'], keep='first')
    print(f"去重後: {len(df):,} 筆（移除 {before - len(df):,} 筆重複）")

    # 3. 清洗內文
    print("清洗內文中...")
    df['內文'] = df['內文'].apply(clean_ltn_news_text)

    # 4. 再次過濾清洗後太短的文章
    before = len(df)
    df = df[df['內文'].str.strip().str.len() > 30]
    print(f"清洗後過濾: {len(df):,} 筆（移除 {before - len(df):,} 筆過短文章）")

    # 5. 備份原檔
    if not os.path.exists(BACKUP_CSV):
        shutil.copy(LTN_CSV, BACKUP_CSV)
        print(f"已備份原檔至 {BACKUP_CSV}")

    # 6. 儲存清洗後的檔案
    df.to_csv(OUTPUT_CSV, index=False, encoding='utf-8-sig')
    print(f"\n✅ 清洗完成！保留 {len(df):,} 篇，已存至 {OUTPUT_CSV}")

if __name__ == "__main__":
    main()
