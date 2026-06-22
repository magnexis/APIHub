from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


HttpMethod = Literal["GET", "POST"]


class ApiExample(BaseModel):
    request: dict[str, Any] = Field(default_factory=dict)
    response: dict[str, Any] = Field(default_factory=dict)


class ApiDefinition(BaseModel):
    id: str
    name: str
    category: str
    endpoint: str
    method: HttpMethod
    description: str
    inputSchema: dict[str, Any]
    outputSchema: dict[str, Any]
    examples: list[ApiExample] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    complexity: Literal["low", "medium", "high"]
    auth: Literal["none", "optional", "required"] = "none"
    requiredTier: Literal["free", "pro", "enterprise"] = "free"
    family: str
    mode: str
    endpointVariants: list[str] = Field(default_factory=list)
    rateLimitPerMinute: int = 60
    polished: bool = False


class ApiExecuteRequest(BaseModel):
    apiId: str
    method: Optional[HttpMethod] = None
    headers: dict[str, str] = Field(default_factory=dict)
    query: dict[str, Any] = Field(default_factory=dict)
    body: dict[str, Any] = Field(default_factory=dict)


class ApiExecuteResponse(BaseModel):
    apiId: str
    endpoint: str
    method: HttpMethod
    statusCode: int
    latencyMs: int
    requestId: str
    data: dict[str, Any]
    error: Optional[dict[str, Any]] = None


class CollectionItem(BaseModel):
    apiId: str
    note: Optional[str] = None


class Collection(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    items: list[CollectionItem] = Field(default_factory=list)
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)


class WorkflowStep(BaseModel):
    apiId: str
    note: Optional[str] = None


class Workflow(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    steps: list[WorkflowStep] = Field(default_factory=list)
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)
