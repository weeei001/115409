import pandas as pd
import glob
from pathlib import Path
from langchain_text_splitters import RecursiveCharacterTextSplitter
import os

def clean_and_chunk_csv(input_csv):
    """讀取 CSV、清洗資料，並使用 Text Splitter 進行文本切塊"""
    # 讀取原本洗乾淨的 csv
    df = pd.read_csv(input_csv)
    
    # 過濾掉內文為空的行
    df = df.dropna(subset=['內文'])
    df = df[df['內文'].str.strip() != '']
    df = df[df['內文'].str.strip() != '(無內文)']
    
    # 如果清洗後沒有資料，直接跳過
    if len(df) == 0:
        return None

    # 設定 Text Splitter
    # RAG 常見設定：區間長度大約 300~500 字，並保留約 50 字的重疊 (Overlap)，確保語句不會被硬切斷
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=400,
        chunk_overlap=50,
        separators=["\n\n", "\n", "。", "！", "？", "，", " ", ""]
    )
    
    # 準備用來存放 chunk 的陣列
    chunked_data = []
    
    # 股票代號從檔名取得，例如 2330_news.csv -> 2330
    stock_id = Path(input_csv).stem.split('_')[0]
    
    print(f"正在處理 [{stock_id}]... 總共 {len(df)} 篇乾淨新聞，準備進行文本切塊 (Chunking)")
    
    # 遍歷每篇文章
    for idx, row in df.iterrows():
        article_id = row['新聞 ID']
        title = row['標題']
        pub_time = row['發布時間']
        tags = row['標籤']
        url = row['連結']
        content = str(row['內文'])
        
        # 使用 LangChain 切塊
        chunks = text_splitter.split_text(content)
        
        # 幫每個 Chunk 附上 Metadata
        for i, chunk_text in enumerate(chunks):
            chunked_data.append({
                "chunk_id": f"{article_id}_{i}",
                "stock_id": stock_id,
                "article_id": article_id,
                "title": title,
                "pub_time": pub_time,
                "tags": tags,
                "url": url,
                "content_chunk": chunk_text
            })
            
    # 將結果轉換為新的 DataFrame
    chunked_df = pd.DataFrame(chunked_data)
    
    # 輸出的檔名加上 _chunked 作為辨識
    output_filename = f"{stock_id}_news_chunked.csv"
    output_path = Path("crawler") / output_filename
    
    # 存檔
    chunked_df.to_csv(output_path, index=False, encoding='utf-8-sig')
    print(f"[{stock_id}] 處理完成！共產生 {len(chunked_df)} 個 Text Chunks，已存至 {output_path}")

if __name__ == "__main__":
    # 找出 crawler 裡面所有的乾淨新聞 csv
    csv_files = glob.glob(os.path.join("crawler", "*_news_cleaned.csv"))
    
    print(f"找到 {len(csv_files)} 個已清洗新聞檔案準備切塊...")
    
    for f in csv_files:
        clean_and_chunk_csv(f)
