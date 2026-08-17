#!/usr/bin/env python3
"""
检查 MySQL 中的用户和他们的个人观点
"""
import os
import pymysql
from dotenv import load_dotenv

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "rag_deploy", ".env"), override=False)

try:
    conn = pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "localhost"),
        user=os.environ.get("MYSQL_USER", "rag"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        # 全部整併到 topic_stock。RAG 自己的帳號表改名為 rag_users / rag_user_views，
        # 避開 backend 的 users（email/Google 帳號，schema 不同）。
        database=os.environ.get("MYSQL_DATABASE", "topic_stock"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )

    with conn.cursor() as cur:
        # 查看所有用户
        print("=" * 60)
        print("【所有用户】")
        print("=" * 60)
        cur.execute("SELECT id, username, created_at FROM rag_users ORDER BY id")
        users = cur.fetchall()
        for user in users:
            print(f"ID: {user['id']}, 用户名: {user['username']}, 创建时间: {user['created_at']}")

        print("\n" + "=" * 60)
        print("【用户观点记录】")
        print("=" * 60)
        cur.execute("""
            SELECT u.username, v.id, v.question, v.personal_view, v.created_at
            FROM rag_user_views v
            JOIN rag_users u ON v.user_id = u.id
            ORDER BY u.id, v.id
        """)
        views = cur.fetchall()

        if not views:
            print("没有观点记录")
        else:
            current_user = None
            for view in views:
                if view['username'] != current_user:
                    print(f"\n👤 {view['username']}:")
                    current_user = view['username']
                print(f"  [{view['id']}] 情境: {view['question']}")
                print(f"      观点: {view['personal_view']}")
                print(f"      时间: {view['created_at']}")

        print("\n" + "=" * 60)
        print("【统计】")
        print("=" * 60)
        print(f"总用户数: {len(users)}")
        print(f"总观点数: {len(views)}")

    conn.close()

except Exception as e:
    print(f"❌ 错误: {e}")
    print("\n可能的原因:")
    print("1. MySQL 未启动")
    print("2. 数据库连接信息错误")
    print("3. 数据表不存在")
