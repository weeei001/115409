from .daily_price import router as stock_router
from .cnyes_news import router as news_router
from .simulated_order import router as simulated_order_router
from .auth import router as auth_router
from .stock_behavior import router as stock_behavior_router

__all__ = [
    "stock_router",
    "news_router",
    "simulated_order_router",
    "auth_router",
    "stock_behavior_router",
]
