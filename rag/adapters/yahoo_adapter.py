import os
import re
from adapters.base_adapter import BaseNewsAdapter

class YahooAdapter(BaseNewsAdapter):
    def parse(self, file_path):
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            
        if len(lines) < 3:
            return None
            
        title = lines[0].strip()
        time_str = lines[1].strip()
        content = "".join(lines[2:]).strip()
        
        # 嘗試從檔名或內容提取股票代號 (這部分通常需要額外邏輯)
        stock_id = self._extract_stock_id(file_path, title)
        
        # 統一時間格式 (簡單處理，實際可依需求加強)
        # 例如: 2024年3月12日 19時30分12秒 -> 2024-03-12 19:30:12
        formatted_time = self._format_time(time_str)
        
        return {
            "title": title,
            "pub_time": formatted_time,
            "content": content,
            "stock_id": stock_id,
            "url": "file://" + os.path.basename(file_path)
        }

    def _format_time(self, time_str):
        # 簡單正則提取數字
        nums = re.findall(r'\d+', time_str)
        if len(nums) >= 6:
            return f"{nums[0]}-{int(nums[1]):02d}-{int(nums[2]):02d} {int(nums[3]):02d}:{int(nums[4]):02d}:{int(nums[5]):02d}"
        return time_str

    def _extract_stock_id(self, file_path, title):
        # 如果檔名有代號則提取，否則設為未知
        # 這裡假設檔名不包含股票 ID，可能需要從標題或路徑判斷
        return "Unknown"
