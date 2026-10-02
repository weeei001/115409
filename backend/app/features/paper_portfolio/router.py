from fastapi import APIRouter
from app.features.auth.router import CurrentUser, Database
from app.features.paper_portfolio import service
from app.features.paper_portfolio.schemas import FundCreate, OrderCreate

router = APIRouter(prefix='/paper-portfolio', tags=['Paper portfolio'])


@router.get('')
def get_portfolio(user: CurrentUser, db: Database):
    return service.get_portfolio(db, user.id)


@router.post('/orders')
def create_order(body: OrderCreate, user: CurrentUser, db: Database):
    return service.create_order(db, user.id, body)


@router.post('/funds')
def create_fund_movement(body: FundCreate, user: CurrentUser, db: Database):
    return service.create_fund_movement(db, user.id, body)


@router.post('/orders/{order_id}/cancel')
def cancel_order(order_id: str, user: CurrentUser, db: Database):
    return service.cancel_order(db, user.id, order_id)


@router.post('/reviews/{review_id}/acknowledge')
def acknowledge_review(review_id: str, user: CurrentUser, db: Database):
    return service.acknowledge_review(db, user.id, review_id)
