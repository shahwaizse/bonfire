from typing import Literal, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message: str
    search_enabled: bool = False
    # Per-message override; if unset, falls back to the saved prompt mode.
    preset_id: Optional[str] = None


class SearchRequest(BaseModel):
    query: str
    max_results: Optional[int] = None
    include_images: Optional[bool] = None
    safe_search: Optional[int] = None
    time_range: Optional[Literal["day", "week", "month", "year"]] = None


class SearchResultItem(BaseModel):
    title: str
    url: str
    snippet: str = ""
    kind: Literal["web", "image"] = "web"
    source: Optional[str] = None
    domain: Optional[str] = None
    thumbnail_url: Optional[str] = None
    image_url: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    published_date: Optional[str] = None
    score: Optional[float] = None


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResultItem]


class ReadPageRequest(BaseModel):
    url: str


class ReadPageResponse(BaseModel):
    title: str
    url: str
    excerpt: str


class MessageOut(BaseModel):
    id: int
    role: Literal["user", "assistant", "system"]
    content: str
    preset_id: Optional[str] = None
    sources: Optional[list[SearchResultItem]] = None
    memory_ids: Optional[list[str]] = None
    created_at: str


class ConversationOut(BaseModel):
    id: str
    title: str
    folder: str = ""
    created_at: str
    updated_at: str


class ConversationDetailOut(ConversationOut):
    messages: list[MessageOut]


class ConversationUpdateRequest(BaseModel):
    title: Optional[str] = None
    folder: Optional[str] = None


class PresetOut(BaseModel):
    id: str
    name: str
    description: str
    system_prompt: str
    keywords: list[str]
    is_builtin: bool


class PresetUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    keywords: Optional[list[str]] = None


class PresetCreateRequest(BaseModel):
    name: str
    description: str = ""
    system_prompt: str
    keywords: list[str] = []


class SettingsOut(BaseModel):
    prompt_mode: Literal["auto", "preset", "custom"]
    active_preset_id: str
    custom_prompt: str
    search_default: bool
    guardrails: str
    memory_enabled: bool
    memory_auto_extract: bool
    funnel_enabled: bool


class SettingsUpdateRequest(BaseModel):
    prompt_mode: Optional[Literal["auto", "preset", "custom"]] = None
    active_preset_id: Optional[str] = None
    custom_prompt: Optional[str] = None
    search_default: Optional[bool] = None
    guardrails: Optional[str] = None
    memory_enabled: Optional[bool] = None
    memory_auto_extract: Optional[bool] = None
    funnel_enabled: Optional[bool] = None


class FunnelUpdateRequest(BaseModel):
    enabled: bool


class FunnelStatusOut(BaseModel):
    saved_enabled: bool
    installed: bool
    active: bool
    frontend: bool
    backend: bool
    error: Optional[str] = None


class MemoryOut(BaseModel):
    id: str
    text: str
    kind: Literal["semantic", "preference", "episodic", "procedural"]
    scope: str = "user"
    topics: list[str] = Field(default_factory=list)
    entities: list[str] = Field(default_factory=list)
    confidence: float
    pinned: bool = False
    archived: bool = False
    source_conversation_id: Optional[str] = None
    source_message_id: Optional[int] = None
    created_at: str
    updated_at: str
    last_used_at: Optional[str] = None
    use_count: int = 0


class MemoryCreateRequest(BaseModel):
    text: str
    kind: Literal["semantic", "preference", "episodic", "procedural"] = "semantic"
    topics: list[str] = Field(default_factory=list)
    entities: list[str] = Field(default_factory=list)
    confidence: float = 0.85
    pinned: bool = False


class MemoryUpdateRequest(BaseModel):
    text: Optional[str] = None
    kind: Optional[Literal["semantic", "preference", "episodic", "procedural"]] = None
    topics: Optional[list[str]] = None
    entities: Optional[list[str]] = None
    confidence: Optional[float] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None


class MemoryStatusOut(BaseModel):
    active: int
    archived: int
    chroma_available: bool
    chroma_count: Optional[int] = None


class MemoryGraphNode(BaseModel):
    id: str
    label: str
    type: str
    weight: float = 0.5


class MemoryGraphEdge(BaseModel):
    source: str
    target: str
    label: str
    weight: float = 0.3


class MemoryGraphOut(BaseModel):
    nodes: list[MemoryGraphNode]
    edges: list[MemoryGraphEdge]
