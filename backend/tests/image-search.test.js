import test from 'node:test';
import assert from 'node:assert/strict';
import { isPictureRequest, searchImages, publicImageUrl } from '../src/image-search.js';
import { createProviderSearch } from '../src/search-providers.js';
import { SearchUsage } from '../src/search-usage.js';

test('manual Web prefetch skips picture requests without routing image searches', () => {
  for (const text of ['can you bring up pictures of megan fox?', 'show me photos of auroras', 'find images of edge servers', 'pictures of cats']) assert.equal(isPictureRequest(text), true, text);
  for (const text of ['hi', 'what is image search?', 'write a React component to display images', 'write code for image classification']) assert.equal(isPictureRequest(text), false, text);
  assert.equal(isPictureRequest('more pictures', [{ role: 'user', content: 'show me pictures of cats' }]), true);
});
test('image normalization deduplicates and rejects unsafe URLs', async () => {
  const results = await searchImages('cats', { searchProvider: async (_query, _count, options) => {
    assert.equal(options.kind, 'images');
    return [{ url: 'https://images.example.com/cat.jpg', title: 'Cat', source_url: 'https://example.com/cats' },
      { url: 'https://images.example.com/cat.jpg' }, { url: 'javascript:alert(1)' }, { url: 'http://127.0.0.1/private.png' }];
  } });
  assert.equal(results.length, 1);
  assert.equal(results[0].thumbnail, results[0].url);
  for (const url of ['file:///C:/secret.png', 'http://localhost/a', 'http://192.168.1.1/a', 'http://[::1]/a', 'https://user:password@example.com/a', 'https://example.com:8000/a']) assert.equal(publicImageUrl(url), '', url);
});
test('gallery filters page decorations unless explicitly requested', async () => {
  const searchProvider = async () => [{url:'https://example.com/photo.jpg'}, {url:'https://example.com/wordmark.svg'}, {url:'https://example.com/static/images/favicon.png'}];
  assert.equal((await searchImages('Megan Fox', {searchProvider})).length, 1);
  assert.equal((await searchImages('Wikipedia logo', {searchProvider})).length, 3);
});

function provider(t, options = {}) {
  const usage = new SearchUsage(':memory:'); t.after(() => usage.close());
  return createProviderSearch({ tavilyKey: 'test-tavily', braveKey: 'test-brave', tavilyFreeOnly: true, braveFreeOnly: true, usage, ...options });
}
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
test('Tavily image search stays basic and preserves source attribution', async t => {
  const search = provider(t, { fetchFn: async (url, options) => {
    assert.equal(url, 'https://api.tavily.com/search');
    const body = JSON.parse(options.body);
    assert.equal(body.search_depth, 'basic'); assert.equal(body.auto_parameters, false);
    assert.equal(body.include_images, true); assert.equal(body.include_image_descriptions, false);
    return json({ images: ['https://images.example.com/photo.jpg'], results: [{ url: 'https://example.com/source', title: 'Gallery', images: [{ url: 'https://images.example.com/photo.jpg' }] }] });
  } });
  const images = await search('cats', 8, { kind: 'images' });
  assert.equal(images[0].source_url, 'https://example.com/source');
  assert.equal(images[0].source, 'Tavily');
});
test('Tavily exhausted or empty images fall back to Brave images endpoint', async t => {
  for (const status of [432, 200]) {
    const calls = [];
    const search = provider(t, { fetchFn: async (url, options) => {
      calls.push(String(url));
      if (String(url).includes('tavily')) return status === 432 ? new Response('', { status }) : json({ results: [], images: [] });
      assert.match(String(url), /res\/v1\/images\/search/);
      assert.equal(options.headers['X-Subscription-Token'], 'test-brave');
      return json({ results: [{ title: 'Cat', url: 'https://example.org/source', properties: { url: 'https://images.example.org/cat.jpg' }, thumbnail: { src: 'https://cdn.example.org/thumb.jpg' } }] });
    } });
    const images = await searchImages('cats', { searchProvider: search });
    assert.equal(calls.length, 2); assert.equal(images[0].source, 'Brave');
    assert.equal(images[0].thumbnail, 'https://cdn.example.org/thumb.jpg');
    assert.equal(images[0].source_url, 'https://example.org/source');
  }
});
test('web and image search share the same conservative free quotas', async t => {
  let calls = 0;
  const search = provider(t, { tavilyLimit: 1, braveLimit: 0, fetchFn: async () => { calls++; return json({ results: [], images: [] }); } });
  await search('web', 4);
  await assert.rejects(search('images', 8, { kind: 'images' }), /free request limit/);
  assert.equal(calls, 1);
});
