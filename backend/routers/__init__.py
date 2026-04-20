from .daily_price import router as stock_router
from .cnyes_news import router as news_router
from .technical_indicator import router as indicator_router
from .simulated_order import router as simulated_order_router
from .institutional_trade import router as institutional_trade_router
from .chat import router as chat_router
from .auth import router as auth_router
from .backtest import router as backtest_router

__all__ = [
    "stock_router",
    "news_router",
    "indicator_router",
    "simulated_order_router",
    "institutional_trade_router",
    "chat_router",
    "auth_router",
    "backtest_router",
]
