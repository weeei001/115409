from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import Settings, application_environment, get_settings
from app.core.errors import install_error_handlers
from app.core.http import make_http_client
from app.db.session import make_engine, make_session_factory


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = make_engine(settings)
        app.state.session_factory = make_session_factory(engine)
        try:
            async with make_http_client(settings) as http:
                app.state.http = http
                from app.jobs.runtime import JobRuntime
                import asyncio

                jobs = JobRuntime(settings, app.state.session_factory)
                app.state.jobs = jobs
                jobs.start()
                try:
                    yield
                finally:
                    await asyncio.to_thread(jobs.stop)
        finally:
            engine.dispose()

    app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION, lifespan=lifespan)
    app.state.settings = settings
    app.state.environment = application_environment()
    install_error_handlers(app)
    app.add_middleware(
        CORSMiddleware, allow_origins=[origin.strip() for origin in settings.CORS_ALLOW_ORIGINS.split(",") if origin.strip()], allow_credentials=True,
        allow_methods=["*"], allow_headers=["*"],
    )

    from app.features.auth.router import router as auth_router
    from app.features.market.router import router as market_router
    from app.features.news.router import router as news_router
    from app.features.orders.router import router as orders_router
    from app.features.favorites.router import router as favorites_router
    from app.features.analysis.router import prediction_router, router as analysis_router
    from app.features.chat.router import router as chat_router
    from app.features.conversations.router import router as conversations_router
    from app.features.retrieval.router import router as retrieval_router
    from app.features.simulation.router import router as simulation_router
    from app.features.admin.router import router as admin_router
    from app.features.notifications.router import router as notifications_router

    app.include_router(market_router)
    app.include_router(news_router)
    app.include_router(auth_router)
    app.include_router(orders_router)
    app.include_router(favorites_router)
    app.include_router(analysis_router)
    app.include_router(prediction_router)
    app.include_router(chat_router)
    app.include_router(conversations_router)
    app.include_router(retrieval_router)
    app.include_router(simulation_router)
    app.include_router(admin_router)
    app.include_router(notifications_router)

    @app.get("/", tags=["系統"])
    def read_root():
        return {"message": "歡迎使用 FastAPI + MySQL 後端應用",
                "version": settings.APP_VERSION, "docs": "/docs"}

    @app.get("/health", tags=["系統"])
    def health_check():
        return {"status": "healthy"}

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.APP_HOST, port=settings.APP_PORT, reload=settings.APP_RELOAD)
