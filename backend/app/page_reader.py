import asyncio

from playwright.async_api import async_playwright

from app.config import PAGE_EXCERPT_CHARS

_playwright = None
_browser = None
_browser_lock = asyncio.Lock()


async def start_browser() -> None:
    global _playwright, _browser
    async with _browser_lock:
        if _browser is not None and _browser.is_connected():
            return
        _browser = None
        if _playwright is not None:
            await _playwright.stop()
            _playwright = None
        _playwright = await async_playwright().start()
        _browser = await _playwright.chromium.launch()


async def close_browser() -> None:
    global _playwright, _browser
    async with _browser_lock:
        if _browser is not None:
            await _browser.close()
            _browser = None
        if _playwright is not None:
            await _playwright.stop()
            _playwright = None


async def read_page(url: str) -> dict:
    await start_browser()
    page = await _browser.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=20000)
        title = await page.title()
        text = await page.evaluate("document.body ? document.body.innerText : ''")
    finally:
        await page.close()

    excerpt = " ".join(text.split())[:PAGE_EXCERPT_CHARS]
    return {"title": title, "url": url, "excerpt": excerpt}
