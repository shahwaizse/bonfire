import test from "node:test";
import assert from "node:assert/strict";
import { readPage } from "../src/page-reader.js";

test("readPage prefers article text and strips boilerplate", async () => {
  const originalFetch = globalThis.fetch;
  const html = `<!doctype html>
    <html>
      <head>
        <title>Fallback title</title>
        <meta property="og:title" content="Useful Article">
        <meta name="description" content="A compact summary worth keeping.">
      </head>
      <body>
        <nav>Home Search Trending Login</nav>
        <aside class="related">Related clickbait that should not dominate extraction.</aside>
        <article>
          <h1>Useful Article</h1>
          <p>This paragraph contains the useful evidence that the model should receive from the page reader.</p>
          <p>A second useful paragraph gives the extractor enough real content to rank this article above chrome.</p>
        </article>
        <footer>Privacy Terms</footer>
      </body>
    </html>`;

  globalThis.fetch = async () =>
    new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });

  try {
    const page = await readPage("https://example.com/useful");
    assert.equal(page.title, "Useful Article");
    assert.equal(page.requested_url, "https://example.com/useful");
    assert.match(page.excerpt, /compact summary/);
    assert.match(page.excerpt, /useful evidence/);
    assert.doesNotMatch(page.excerpt, /Related clickbait/);
    assert.doesNotMatch(page.excerpt, /Privacy Terms/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readPage parses HTML even when content-type is missing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("<!doctype html><html><head><title>No Type</title></head><body><main><p>Visible article text survives.</p></main></body></html>", {
      status: 200,
    });

  try {
    const page = await readPage("https://example.com/no-type");
    assert.equal(page.title, "No Type");
    assert.match(page.excerpt, /Visible article text/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readPage reports unsupported binary responses without dumping bytes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("not really an image", {
      status: 200,
      headers: { "content-type": "image/png" },
    });

  try {
    const page = await readPage("https://example.com/image.png");
    assert.match(page.excerpt, /can only extract text/);
    assert.equal(page.requested_url, "https://example.com/image.png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
