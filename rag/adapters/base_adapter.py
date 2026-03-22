from abc import ABC, abstractmethod

class BaseNewsAdapter(ABC):
    """
    新聞解析適配器基底類別
    所有網站的解析器都必須繼承此類別並實作 parse 方法。
    """
    @abstractmethod
    def parse(self, file_path):
        """
        解析檔案內容並傳回標準化格式
        傳回格式:
        {
            "title": str,
            "pub_time": str (YYYY-MM-DD HH:MM:SS),
            "content": str,
            "stock_id": str,
            "url": str (optional)
        }
        """
        pass
