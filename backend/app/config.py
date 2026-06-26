import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

LLAMA_BASE_URL = os.getenv("LLAMA_BASE_URL", "http://127.0.0.1:8080")
SEARXNG_BASE_URL = os.getenv("SEARXNG_BASE_URL", "http://127.0.0.1:8888")
DATABASE_PATH = os.getenv("DATABASE_PATH", "./data/app.db")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://127.0.0.1:3000,http://localhost:3000").split(",")
    if origin.strip()
]

MAX_SEARCH_RESULTS = int(os.getenv("MAX_SEARCH_RESULTS", "5"))
MAX_PAGES_TO_READ = int(os.getenv("MAX_PAGES_TO_READ", "2"))
PAGE_EXCERPT_CHARS = int(os.getenv("PAGE_EXCERPT_CHARS", "4000"))
MAX_HISTORY_CHARS = int(os.getenv("MAX_HISTORY_CHARS", "12000"))
SEARCH_TIMEOUT_SECONDS = float(os.getenv("SEARCH_TIMEOUT_SECONDS", "15"))
SEARCH_QUERY_VARIANTS = int(os.getenv("SEARCH_QUERY_VARIANTS", "3"))
SEARCH_IMAGE_RESULTS = int(os.getenv("SEARCH_IMAGE_RESULTS", "6"))
SEARCH_SAFESEARCH_DEFAULT = int(os.getenv("SEARCH_SAFESEARCH_DEFAULT", "0"))
SEARCH_LANGUAGE = os.getenv("SEARCH_LANGUAGE", "auto")

MEMORY_CHROMA_PATH = os.getenv("MEMORY_CHROMA_PATH", "./data/chroma")
MEMORY_COLLECTION_NAME = os.getenv("MEMORY_COLLECTION_NAME", "bonfire_memories")
MEMORY_EMBEDDING_DIM = int(os.getenv("MEMORY_EMBEDDING_DIM", "384"))
MEMORY_RETRIEVAL_LIMIT = int(os.getenv("MEMORY_RETRIEVAL_LIMIT", "8"))
MEMORY_CONTEXT_LIMIT = int(os.getenv("MEMORY_CONTEXT_LIMIT", "6"))
MEMORY_MIN_RELEVANCE = float(os.getenv("MEMORY_MIN_RELEVANCE", "0.18"))
MEMORY_EXTRACT_MAX_TOKENS = int(os.getenv("MEMORY_EXTRACT_MAX_TOKENS", "700"))

LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.72"))
LLM_TOP_P = float(os.getenv("LLM_TOP_P", "0.92"))
LLM_MIN_P = float(os.getenv("LLM_MIN_P", "0.04"))
LLM_REPEAT_PENALTY = float(os.getenv("LLM_REPEAT_PENALTY", "1.08"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "4096"))

DEFAULT_GUARDRAILS = os.getenv("DEFAULT_GUARDRAILS", "")
