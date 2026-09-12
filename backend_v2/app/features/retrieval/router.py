from fastapi import APIRouter, Depends, Request

from .schemas import RetrievalRequest, RetrievalResponse
from .service import RetrievalService


router = APIRouter(tags=["Retrieval"])


def get_service(request: Request) -> RetrievalService:
    return RetrievalService(request.app.state.http, request.app.state.settings)


@router.post("/api/analyze", response_model=RetrievalResponse,
             responses={400: {"description": "Invalid stock or date"},
                        503: {"description": "Retrieval unavailable"}})
async def analyze(req: RetrievalRequest, service: RetrievalService = Depends(get_service)):
    return await service.analyze(req)
