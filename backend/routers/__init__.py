from .daily_price import router as stock_router
from .cnyes_news import router as news_router
from .technical_indicator import router as indicator_router
from .simulated_order import router as simulated_order_router
from .institutional_trade import router as institutional_trade_router
from .auth import router as auth_router
from .core_mode import router as core_mode_router
from .advisor import router as advisor_router
from .advisor_report import router as advisor_report_router

__all__ = [
    "stock_router",
    "news_router",
    "indicator_router",
    "simulated_order_router",
    "institutional_trade_router",
    "auth_router",
    "core_mode_router",
    "advisor_router",
    "advisor_report_router",
]
