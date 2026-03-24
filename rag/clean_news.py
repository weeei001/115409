import pandas as pd
import glob
import os
import re
from pathlib import Path

def clean_ltn_news_text(text):
    """清洗自由時報 (LTN) 財經新聞內文"""
    if not isinstance(text, str) or not text.strip():
        return ""

    # 1. 切除底部導覽/廣告雜訊
    bottom_keywords = [
        "一手掌握經濟脈動",
        "按我看活動辦法",
        "相關新聞",
        "基金查詢more",
        "熱門新訊more",
        "注目新聞",
        "請繼續往下閱讀",
        "延伸閱讀",
        "看更多相關新聞",
    ]
    for kw in bottom_keywords:
        idx = text.find(kw)
        if idx != -1:
            text = text[:idx]

    # 2. 移除圖片說明行（獨立一行的短句含括號來源）
    text = re.sub(r'^.{0,80}（[^）\n]{2,20}[攝提供截取資料照示意圖]{1,3}[^）\n]{0,10}）\s*$', '', text, flags=re.MULTILINE)

    # 3. 移除記者/編輯署名行
    text = re.sub(r'^[^\n]{2,15}／(核稿編輯|記者|特約記者)[^\n]*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'^〔記者[^\n]{2,30}報導〕\s*', '', text, flags=re.MULTILINE)

    # 4. 壓縮多餘空行
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()


def clean_cmoney_news_text(text):
    if pd.isna(text) or not isinstance(text, str):
        return ""
    
    # 底部雜訊: 遇到這些關鍵字就全部切斷
    bottom_keywords = [
        "文章相關標籤",
        "今日最熱",
        "更多文章",
        "本文內容轉載",
        "收藏內容 讓好文不錯過",
        "全站最新",
        "延伸閱讀：",
        "免責宣言",
        "點我下載",
        "點我加入",
        "文章出處：",
        "如果喜歡我的文章",
        "歡迎訂閱",
        "＊本文章之版權屬筆者"
    ]
    for kw in bottom_keywords:
        idx = text.find(kw)
        if idx != -1:
            text = text[:idx]
            
    # 頂部雜訊: 使用正則表達式尋找時間標記或特定字串
    top_search_area = text[:400]
    match = re.search(r'\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?:\:\d{2})?(?:\s*[\d,]+)?', top_search_area)
    if match:
        # 切除匹配到的結尾位置之前的文字
        text = text[match.end():]
        
    # 頂部第二層雜訊: (更新：2025-08-14 15:55) 13,086
    match_update = re.search(r'\(更新：\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\)\s*[\d,]*', text[:200])
    if match_update:
        text = text[match_update.end():]
        
    return text.strip()

def process_and_clean_csv(input_csv):
    """讀取 CSV、清洗資料，並存成新的 _cleaned 文件"""
    df = pd.read_csv(input_csv)
    
    # 基礎清洗: 移除空缺或無效列
    df = df.dropna(subset=['內文'])
    df = df[df['內文'].str.strip() != '']
    df = df[df['內文'].str.strip() != '取得失敗']
    df = df[df['內文'].str.strip() != '(無內文)']
    
    if len(df) == 0:
        return
    
    # 時間欄位格式化與排序
    df['發布時間'] = pd.to_datetime(df['發布時間'], errors='coerce')
    df = df.sort_values(by='發布時間', ascending=False)
    
    # 深度清洗: 應用正則表達式清理網頁雜訊
    stock_id = Path(input_csv).stem.split('_')[0]
    print(f"正在清洗 [{stock_id}]... 原本共 {len(df)} 篇文章。")
    
    df['內文'] = df['內文'].apply(clean_cmoney_news_text)
    
    # 再次過濾掉清洗完後變成空字串的列
    df = df[df['內文'].str.strip() != '']
    
    # 輸出成結尾為 _cleaned.csv 的檔案
    output_filename = f"{stock_id}_news_cleaned.csv"
    output_path = Path("crawler") / output_filename
    
    df.to_csv(output_path, index=False, encoding='utf-8-sig')
    print(f"[{stock_id}] 清洗完成！保留乾淨文章共 {len(df)} 篇，已存至 {output_path}")

if __name__ == "__main__":
    csv_files = glob.glob(os.path.join("crawler", "*_news.csv"))
    
    # 只針對來源檔進行處理，不要動到原本的 _chunked 或 _cleaned
    csv_files = [f for f in csv_files if not f.endswith("_chunked.csv") and not f.endswith("_cleaned.csv")]
    
    print(f"找到 {len(csv_files)} 個新聞檔案需要清洗...\n")
    
    for f in csv_files:
        process_and_clean_csv(f)
