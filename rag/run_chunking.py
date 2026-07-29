import time

from langchain_text_splitters import RecursiveCharacterTextSplitter

from news_storage_mysql import NewsStorageManagerMySQL
from chunk_storage_mysql import ensure_table, get_chunked_article_ids, insert_chunks


def run_standardized_chunking(db_manager):
    """對尚未切塊的新聞進行標準化切塊，寫入 MySQL news_chunks 表（以 article_id 判斷斷點續傳）。"""
    ensure_table()
    already_chunked = get_chunked_article_ids()

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=400,
        chunk_overlap=50,
        separators=["\n\n", "\n", "。", "！", "？", "，", " ", ""]
    )

    articles = db_manager.get_all_articles()
    pending = [a for a in articles if a["article_id"] not in already_chunked]
    total_news = len(pending)

    print(f"Starting standardized chunking for {total_news} articles (共 {len(articles)} 篇，已切塊 {len(already_chunked)} 篇)...")
    start_time = time.time()

    batch = []
    for idx, item in enumerate(pending):
        article_id = item["article_id"]
        content = db_manager.get_content(article_id)

        if not content:
            continue

        chunks = text_splitter.split_text(content)

        for i, chunk_text in enumerate(chunks):
            batch.append({
                "chunk_id": f"{article_id}_{i}",
                "article_id": article_id,
                "stock_id": item["stock_id"],
                "source": item["source"],
                "pub_time": item["pub_time"],
                "title": item["title"],
                "url": item.get("url", ""),
                "tags": item.get("tags", ""),
                "content_chunk": chunk_text,
            })

        if len(batch) >= 1000:
            insert_chunks(batch)
            batch = []

        if (idx + 1) % 500 == 0:
            print(f"  - Processed {idx + 1}/{total_news} articles...")

    if batch:
        insert_chunks(batch)

    end_time = time.time()
    print(f"Chunking completed in {end_time - start_time:.2f} seconds.")


if __name__ == "__main__":
    db = NewsStorageManagerMySQL()
    run_standardized_chunking(db)
