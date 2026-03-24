import json
import os
import hashlib
import re
from datetime import datetime

class NewsStorageManager:
    """
    本機新聞資料庫管理器 (Local News DB Manager)
    針對 2GB RAM 優化：索引常駐記憶體，全文內容存於磁碟。
    """
    MEDIA_SOURCES = {"cnyes", "ltn", "moneydj", "udn", "yahoo", "chinatimes"}

    def __init__(self, db_root="news_db_local"):
        self.db_root = db_root
        self.index_path = os.path.join(db_root, "index.json")
        # content_dir 保留作為回溯相容（舊檔案仍在這裡）
        self.content_dir = os.path.join(db_root, "content")

        # 載入索引
        self.index = self._load_index()

    def _source_group(self, source):
        """將 source 對應到資料夾名稱；非媒體來源統一歸入 cmoney"""
        return source if source in self.MEDIA_SOURCES else "cmoney"

    def _source_content_dir(self, source):
        d = os.path.join(self.db_root, self._source_group(source), "content")
        os.makedirs(d, exist_ok=True)
        return d

    def _load_index(self):
        if os.path.exists(self.index_path):
            with open(self.index_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {"news": [], "stats": {"total_count": 0, "sources": {}}}

    def clean_text(self, text):
        """整合原本 clean_news.py 的清洗邏輯"""
        if not isinstance(text, str) or not text:
            return ""
        
        # 底部雜訊: 遇到這些關鍵字就全部切斷
        bottom_keywords = [
            "文章相關標籤", "今日最熱", "更多文章", "本文內容轉載",
            "收藏內容 讓好文不錯過", "全站最新", "延伸閱讀：", "免責宣言",
            "點我下載", "點我加入", "文章出處：", "如果喜歡我的文章",
            "歡迎訂閱", "＊本文章之版權屬筆者", "閱讀VIP文章請先登入"
        ]
        for kw in bottom_keywords:
            idx = text.find(kw)
            if idx != -1:
                text = text[:idx]
                
        # 頂部雜訊: 使用正則表達式尋找時間標記或特定字串
        top_search_area = text[:400]
        match = re.search(r'\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?:\:\d{2})?(?:\s*[\d,]+)?', top_search_area)
        if match:
            text = text[match.end():]
            
        # 頂部第二層雜訊: (更新：2025-08-14 15:55) 13,086
        match_update = re.search(r'\(更新：\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\)\s*[\d,]*', text[:200])
        if match_update:
            text = text[match_update.end():]
            
        return text.strip()

    def _save_index(self):
        with open(self.index_path, 'w', encoding='utf-8') as f:
            json.dump(self.index, f, ensure_ascii=False, indent=2)

    def _generate_article_id(self, source, title, pub_time):
        """生成唯一 ID 以便去重"""
        unique_str = f"{source}_{title}_{pub_time}"
        return hashlib.md5(unique_str.encode('utf-8')).hexdigest()

    def add_news(self, source, stock_id, title, content, pub_time, url="", tags=""):
        """
        新增新聞至本機資料庫
        :param source: 來源平台 (yahoo, cnyes...)
        :param stock_id: 股票代號
        :param title: 新聞標題
        :param content: 新聞全文
        :param pub_time: 發布時間 (格式: YYYY-MM-DD HH:MM:SS)
        :param url: 來源網址
        :param tags: 標籤（逗號分隔字串，如「台股產業,航運,長榮(2603)」）
        """
        article_id = self._generate_article_id(source, title, pub_time)
        
        # 檢查是否已存在 (去重)
        if any(item['article_id'] == article_id for item in self.index['news']):
            return False, "Duplicate article"

        # 執行資料清洗
        cleaned_content = self.clean_text(content)
        if not cleaned_content:
            return False, "Empty content after cleaning"

        # 1. 存入全文 (Content) - 依來源分資料夾
        source_content_dir = self._source_content_dir(source)
        content_filename = f"{article_id}.txt"
        content_path = os.path.join(source_content_dir, content_filename)
        with open(content_path, 'w', encoding='utf-8') as f:
            f.write(cleaned_content)

        # 2. 更新索引 (Metadata)
        source_group = self._source_group(source)
        metadata = {
            "article_id": article_id,
            "source": source,
            "source_group": source_group,
            "stock_id": stock_id,
            "title": title,
            "pub_time": pub_time,
            "url": url,
            "tags": tags,
            "content_file": f"{source_group}/{content_filename}"
        }
        self.index['news'].append(metadata)
        
        # 3. 更新統計資訊
        self.index['stats']['total_count'] += 1
        self.index['stats']['sources'][source] = self.index['stats']['sources'].get(source, 0) + 1
        
        self._save_index()
        return True, article_id

    def get_news_by_stock(self, stock_id):
        """篩選特定股票的新聞"""
        return [item for item in self.index['news'] if item['stock_id'] == stock_id]

    def get_full_content(self, article_id):
        """讀取新聞全文內容（支援新舊路徑結構）"""
        # 先從 index 查找 content_file 路徑
        for item in self.index['news']:
            if item['article_id'] == article_id:
                cf = item.get('content_file', f"{article_id}.txt")
                # 新結構：source_group/article_id.txt
                new_path = os.path.join(self.db_root, cf)
                if os.path.exists(new_path):
                    with open(new_path, 'r', encoding='utf-8') as f:
                        return f.read()
                break
        # 回溯相容：舊結構 content/article_id.txt
        old_path = os.path.join(self.content_dir, f"{article_id}.txt")
        if os.path.exists(old_path):
            with open(old_path, 'r', encoding='utf-8') as f:
                return f.read()
        return None

if __name__ == "__main__":
    # 測試程式碼
    db = NewsStorageManager()
    success, res = db.add_news(
        source="test_site",
        stock_id="2330",
        title="台積電法說會亮點",
        content="這是測試內文...",
        pub_time="2024-03-13 10:00:00"
    )
    print(f"Add News: {success}, {res}")
    
    news_list = db.get_news_by_stock("2330")
    print(f"Found {len(news_list)} news for 2330")
