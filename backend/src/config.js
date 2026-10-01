import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
export const SRC_DIR = path.dirname(__filename);
export const BACKEND_DIR = path.resolve(SRC_DIR, "..");

dotenv.config({ path: path.join(BACKEND_DIR, ".env"), quiet: true });

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function resolveBackendPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(BACKEND_DIR, value);
}

export const HOST = process.env.HOST || "127.0.0.1";
export const PORT = numberFromEnv("PORT", 8000);
export const LLAMA_BASE_URL = process.env.LLAMA_BASE_URL || "http://127.0.0.1:8082";
export const DATABASE_PATH = resolveBackendPath(process.env.DATABASE_PATH || "./data/app.db");
export const SEARCH_USAGE_PATH = resolveBackendPath(process.env.SEARCH_USAGE_PATH || path.join(path.dirname(DATABASE_PATH), "search-usage.db"));
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";
export const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY || "";
export const TAVILY_FREE_ONLY_CONFIRMED = process.env.TAVILY_FREE_ONLY_CONFIRMED === "true";
export const BRAVE_FREE_ONLY_CONFIRMED = process.env.BRAVE_FREE_ONLY_CONFIRMED === "true";
// These are upper bounds, not a substitute for provider-side billing restrictions.
export const TAVILY_MONTHLY_LIMIT = Math.max(0, Math.min(1000, Math.floor(numberFromEnv("TAVILY_MONTHLY_LIMIT", 1000))));
export const BRAVE_MONTHLY_LIMIT = Math.max(0, Math.min(1000, Math.floor(numberFromEnv("BRAVE_MONTHLY_LIMIT", 1000))));

export const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://127.0.0.1:3000,http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const MAX_HISTORY_CHARS = numberFromEnv("MAX_HISTORY_CHARS", 10000);
export const MAX_HISTORY_TOKENS = Math.max(256, numberFromEnv('MAX_HISTORY_TOKENS', 2400));
export const MAX_SEARCH_RESULTS = numberFromEnv("MAX_SEARCH_RESULTS", 4);
export const MAX_PAGES_TO_READ = numberFromEnv("MAX_PAGES_TO_READ", 2);
export const MAX_DIRECT_URLS = numberFromEnv("MAX_DIRECT_URLS", 3);
export const PAGE_EXCERPT_CHARS = numberFromEnv("PAGE_EXCERPT_CHARS", 4500);
export const SEARCH_TIMEOUT_SECONDS = numberFromEnv("SEARCH_TIMEOUT_SECONDS", 10);
export const SEARCH_SAFESEARCH_DEFAULT = numberFromEnv("SEARCH_SAFESEARCH_DEFAULT", 0);
export const SEARCH_LANGUAGE = process.env.SEARCH_LANGUAGE || "auto";

export const LLM_TEMPERATURE = numberFromEnv("LLM_TEMPERATURE", 0.1);
export const LLM_MODEL = process.env.LLM_MODEL || 'gemma';
export const LLM_MODEL_NAME = process.env.LLM_MODEL_NAME || 'Gemma 4 E4B';
export const LLM_TOP_P = numberFromEnv("LLM_TOP_P", 1);
export const LLM_MIN_P = numberFromEnv("LLM_MIN_P", 0);
export const LLM_REPEAT_PENALTY = numberFromEnv("LLM_REPEAT_PENALTY", 1);
export const LLM_MAX_TOKENS = numberFromEnv("LLM_MAX_TOKENS", 2048);
