"""
update_stock_id.py
把向量資料庫中 stock_id='tw_stock' 的切塊
根據 title + page_content 關鍵字重新標記正確的 stock_id
"""

from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue, PointIdsList
import sys

KEYWORDS = {
    '2330': ['台積電', 'TSMC', 'tsmc', 'TSM'],
    '2317': ['鴻海', '富士康', 'Foxconn', 'foxconn', 'Hon Hai'],
    '2454': ['聯發科', 'MediaTek', 'mediatek'],
    '2881': ['富邦金', '富邦人壽', '富邦銀行', '富邦證券', '富邦投信', '富邦'],
    '2408': ['南亞科', '南亞科技'],
    '2615': ['萬海', '萬海航運'],
}

BATCH_SIZE = 500

def main():
    print("連接 Qdrant...")
    client = QdrantClient(path='./qdrant_db')

    # 先取得總數
    info = client.get_collection('news_chunks')
    total_points = info.points_count
    print(f"資料庫總筆數: {total_points:,}")

    # Scroll 全部 tw_stock
    print("\n掃描 tw_stock 切塊...")
    all_tw = []
    offset = None
    while True:
        batch, next_offset = client.scroll(
            collection_name='news_chunks',
            scroll_filter=Filter(must=[
                FieldCondition(key='stock_id', match=MatchValue(value='tw_stock'))
            ]),
            limit=1000,
            offset=offset,
            with_payload=['title', 'page_content']
        )
        all_tw.extend(batch)
        count = len(all_tw)
        print(f"\r  已讀取: {count:,} 筆", end='', flush=True)
        if next_offset is None:
            break
        offset = next_offset

    print(f"\n  tw_stock 總計: {len(all_tw):,} 筆\n")

    # 比對關鍵字
    print("比對關鍵字...")
    update_map = {}  # point_id → new stock_id

    for i, point in enumerate(all_tw):
        title = point.payload.get('title', '')
        content = point.payload.get('page_content', '')
        text = title + ' ' + content

        for sid, kws in KEYWORDS.items():
            if any(kw in text for kw in kws):
                update_map[point.id] = sid
                break

        if (i + 1) % 5000 == 0:
            print(f"\r  比對進度: {i+1:,}/{len(all_tw):,} ({(i+1)/len(all_tw)*100:.1f}%)", end='', flush=True)

    print(f"\r  比對完成: {len(all_tw):,}/{len(all_tw):,} (100.0%)")

    # 統計
    from collections import Counter
    counter = Counter(update_map.values())
    print(f"\n找到需更新: {len(update_map):,} 筆")
    for sid, cnt in sorted(counter.items()):
        print(f"  {sid}: {cnt:,} 筆")

    if not update_map:
        print("沒有需要更新的資料，結束。")
        return

    # 確認
    print()
    ans = input("確認執行更新？(y/N): ").strip().lower()
    if ans != 'y':
        print("已取消。")
        return

    # 批次更新
    print("\n開始批次更新...")
    ids_by_stock = {}
    for pid, sid in update_map.items():
        ids_by_stock.setdefault(sid, []).append(pid)

    total_updated = 0
    for sid, ids in sorted(ids_by_stock.items()):
        batches = [ids[i:i+BATCH_SIZE] for i in range(0, len(ids), BATCH_SIZE)]
        for bi, batch in enumerate(batches):
            client.set_payload(
                collection_name='news_chunks',
                payload={'stock_id': sid},
                points=PointIdsList(points=batch)
            )
            total_updated += len(batch)
            done_in_sid = min((bi+1)*BATCH_SIZE, len(ids))
            print(f"\r  {sid}: {done_in_sid:,}/{len(ids):,} | 全部進度: {total_updated:,}/{len(update_map):,}", end='', flush=True)
        print()  # 換行

    # 驗證結果
    print("\n驗證更新結果...")
    from collections import Counter as C2
    results, _ = client.scroll('news_chunks', limit=200000, with_payload=['stock_id', 'source'])
    src_stock = {}
    for p in results:
        src = p.payload.get('source', '?')
        sid = p.payload.get('stock_id', '?')
        src_stock.setdefault(src, C2())[sid] += 1

    print("\n=== 更新後 stock_id 分佈（cnyes / ltn）===")
    for src in ['cnyes', 'ltn']:
        dist = src_stock.get(src, {})
        tw = dist.get('tw_stock', 0)
        total = sum(dist.values())
        tagged = total - tw
        print(f"\n{src} (共 {total:,} 筆):")
        print(f"  tw_stock（未分類）: {tw:,} ({tw/total*100:.1f}%)")
        for sid in ['2330','2317','2454','2881','2408','2615']:
            cnt = dist.get(sid, 0)
            if cnt:
                print(f"  {sid}: {cnt:,}")
        print(f"  ✅ 已標記: {tagged:,} ({tagged/total*100:.1f}%)")

    print("\n完成！")

if __name__ == '__main__':
    main()
