import json
import os
from langchain_text_splitters import RecursiveCharacterTextSplitter
from news_storage import NewsStorageManager
import time

def run_standardized_chunking(db_manager):
    """
    對所有已收編的新聞進行標準化切塊
    """
    # chunks_dir 保留作為回溯相容；新資料寫入各來源子資料夾
    chunks_dir = os.path.join(db_manager.db_root, "chunks")
    
    # 初始化切塊器 (沿用使用者偏好參數)
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=400,
        chunk_overlap=50,
        separators=["\n\n", "\n", "。", "！", "？", "，", " ", ""]
    )
    
    index = db_manager.index
    total_news = len(index['news'])
    chunk_catalog = []
    
    print(f"Starting standardized chunking for {total_news} articles...")
    start_time = time.time()
    
    for idx, item in enumerate(index['news']):
        article_id = item['article_id']
        content = db_manager.get_full_content(article_id)
        
        if not content:
            continue
            
        # 執行切塊
        chunks = text_splitter.split_text(content)
        
        # 儲存切塊資料
        article_chunks = []
        for i, chunk_text in enumerate(chunks):
            chunk_data = {
                "chunk_id": f"{article_id}_{i}",
                "article_id": article_id,
                "stock_id": item['stock_id'],
                "source": item['source'],
                "pub_time": item['pub_time'],
                "title": item['title'],
                "url": item.get('url', ''),
                "tags": item.get('tags', ''),
                "content_chunk": chunk_text
            }
            article_chunks.append(chunk_data)
        
        # 依來源分資料夾存放 chunks
        source_group = item.get('source_group') or db_manager._source_group(item.get('source', 'cmoney'))
        source_chunks_dir = os.path.join(db_manager.db_root, source_group, "chunks")
        os.makedirs(source_chunks_dir, exist_ok=True)
        chunk_file_path = os.path.join(source_chunks_dir, f"{article_id}_chunks.json")
        with open(chunk_file_path, 'w', encoding='utf-8') as f:
            json.dump(article_chunks, f, ensure_ascii=False, indent=2)
            
        if (idx + 1) % 500 == 0:
            print(f"  - Processed {idx + 1}/{total_news} articles...")
            
    end_time = time.time()
    print(f"Chunking completed in {end_time - start_time:.2f} seconds.")

if __name__ == "__main__":
    db = NewsStorageManager()
    run_standardized_chunking(db)
