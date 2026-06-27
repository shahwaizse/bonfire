import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
export const SRC_DIR = path.dirname(__filename);
export const BACKEND_DIR = path.resolve(SRC_DIR, "..");
export const ROOT_DIR = path.resolve(BACKEND_DIR, "..");

dotenv.config({ path: path.join(BACKEND_DIR, ".env"), quiet: true });

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function resolveBackendPath(value) {
  if (path.isAbsolute(value)) return value;
  return path.resolve(BACKEND_DIR, value);
}

export const HOST = process.env.HOST || "127.0.0.1";
export const PORT = numberFromEnv("PORT", 8000);
export const LLAMA_BASE_URL = process.env.LLAMA_BASE_URL || "http://127.0.0.1:8080";
export const SEARXNG_BASE_URL = process.env.SEARXNG_BASE_URL || "http://127.0.0.1:8888";
export const DATABASE_PATH = resolveBackendPath(process.env.DATABASE_PATH || "./data/app.db");

export const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://127.0.0.1:3000,http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const MAX_SEARCH_RESULTS = numberFromEnv("MAX_SEARCH_RESULTS", 5);
export const MAX_PAGES_TO_READ = numberFromEnv("MAX_PAGES_TO_READ", 2);
export const PAGE_EXCERPT_CHARS = numberFromEnv("PAGE_EXCERPT_CHARS", 4000);
export const MAX_HISTORY_CHARS = numberFromEnv("MAX_HISTORY_CHARS", 12000);
export const SEARCH_TIMEOUT_SECONDS = numberFromEnv("SEARCH_TIMEOUT_SECONDS", 15);
export const SEARCH_QUERY_VARIANTS = numberFromEnv("SEARCH_QUERY_VARIANTS", 3);
export const SEARCH_SAFESEARCH_DEFAULT = numberFromEnv("SEARCH_SAFESEARCH_DEFAULT", 0);
export const SEARCH_LANGUAGE = process.env.SEARCH_LANGUAGE || "auto";

export const LLM_TEMPERATURE = numberFromEnv("LLM_TEMPERATURE", 0.72);
export const LLM_TOP_P = numberFromEnv("LLM_TOP_P", 0.92);
export const LLM_MIN_P = numberFromEnv("LLM_MIN_P", 0.04);
export const LLM_REPEAT_PENALTY = numberFromEnv("LLM_REPEAT_PENALTY", 1.08);
export const LLM_MAX_TOKENS = numberFromEnv("LLM_MAX_TOKENS", 4096);
export const DEFAULT_GUARDRAILS = process.env.DEFAULT_GUARDRAILS || "";
