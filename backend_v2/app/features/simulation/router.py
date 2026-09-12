import json
from contextlib import aclosing
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from .schemas import SimulationRequest
from .service import SimulationService, prepare

router = APIRouter(tags=["simulation"])


def get_inputs(params: Annotated[SimulationRequest, Query()], db: Session = Depends(get_db)):
    return prepare(db, params)


def get_service(request: Request):
    return SimulationService(request.app.state.settings, request.app.state.http)


async def _sse(events):
    async with aclosing(events):
        async for event in events:
            yield f"data: {json.dumps(event, ensure_ascii=False, allow_nan=False)}\n\n"


@router.get("/api/simulate_trading_stream", response_class=StreamingResponse,
            responses={200: {"content": {"text/event-stream": {}}}, 400: {}, 404: {}, 503: {}})
async def simulate_trading(prepared=Depends(get_inputs), service=Depends(get_service)):
    params, inputs = prepared
    return StreamingResponse(_sse(service.events(params, inputs)), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
