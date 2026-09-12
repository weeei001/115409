from collections import defaultdict
import json

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.features.news import repository
from app.features.news.schemas import News, SentimentResponse
from app.features.news.sentiment import article_input_hash


# Frozen identity of the existing sentiment batch configuration, not an LLM configuration.
# Produced by cleaner.get_active_config_hash: constants.DEFAULT_MODEL/PROMPT_VERSION,
# norm_v1, prompt.SYSTEM_PROMPT/SENTIMENT_OUTPUT_SCHEMA_STR, and generation parameters
# max_completion_tokens=1024, reasoning_effort=none. The legacy parity test guards this identity.
ACTIVE_SENTIMENT_CONFIG_HASH = "a7240da41160cd0ff08a6b33f01aff78cd75fb1512d998282535dc707a804eb3"


def attach_sentiments(db: Session, articles, stock: str | None = None, *, settings=None):
    if not articles:
        return []
    article_ids = [article.article_id for article in articles if article.article_id]
    hashes = [ACTIVE_SENTIMENT_CONFIG_HASH]
    if settings is not None:
        from app.features.news.sentiment import active_config_hash
        hashes.append(active_config_hash(settings))
    rows = repository.sentiments(db, article_ids, hashes, stock) if article_ids else []
    current_articles = {article.article_id: article for article in articles}
    by_article = defaultdict(list)
    for row in rows:
        if row.input_hash != article_input_hash(current_articles[row.article_id], row.target_stock_id):
            continue
        try:
            evidence = json.loads(row.evidence) if row.evidence else []
        except (json.JSONDecodeError, TypeError):
            evidence = []
        by_article[row.article_id].append(SentimentResponse(
            target_stock_id=row.target_stock_id, label=row.label or "", reason=row.reason or "",
            evidence=evidence, analyzed_at=row.analyzed_at,
        ))
    return [News.model_validate(article).model_copy(update={"sentiments": by_article[article.article_id]})
            for article in articles]


def news_list(db: Session, *, settings=None, **filters):
    total, articles = repository.news_list(db, **filters)
    return {"page": filters["page"], "page_size": filters["page_size"], "total": total,
            "items": attach_sentiments(db, articles, filters.get("stock"), settings=settings)}


def news_detail(db: Session, article_id: str, stock: str | None = None, *, settings=None):
    article = repository.by_article_id(db, article_id)
    if article is None:
        raise AppError("找不到指定的新聞文章", status_code=404)
    return attach_sentiments(db, [article], stock, settings=settings)[0]
