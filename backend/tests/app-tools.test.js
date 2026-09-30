import test from 'node:test';
import assert from 'node:assert/strict';
import { AppTools } from '../src/app-tools.js';
const mcp = { catalog: async () => [], call: async () => { throw new Error('Unknown tool'); } };
const image = { url: 'https://images.example.com/a.jpg', thumbnail: 'https://images.example.com/a.jpg', source_url: 'https://example.com/source', title: 'Picture', description: '' };

test('images and link reads are tools independent of Web; Web grants search choice', async () => {
  const off = new AppTools({ mcp });
  assert.deepEqual((await off.catalog()).map(tool => tool.function.name), ['search_images', 'read_webpage']);
  assert.equal((await new AppTools({ mcp, webEnabled: true }).catalog()).length, 3);
  await assert.rejects(off.call('search_web', { query: 'latest model' }), /disabled/);
});
test('native image tool emits cumulative gallery metadata and does not add duplicate source footers', async () => {
  const events = [];
  const tools = new AppTools({ mcp, emit: (type, data) => events.push({ type, data }), imageSearchFn: async () => [image] });
  const result = await tools.call('search_images', { query: 'Megan Fox', count: 4 });
  await tools.call('search_images', { query: 'Megan Fox portraits' });
  assert.equal(tools.images.length, 1);
  assert.equal(tools.sources.length, 0);
  assert.equal(JSON.parse(result.content[0].text).gallery_displayed, true);
  assert.equal(events.filter(event => event.type === 'image_results').length, 2);
  await assert.rejects(tools.call('search_images', { query: 'cats', count: 9 }), /Invalid/);
});
test('web tool returns real numbered evidence and deduplicates sources across calls', async () => {
  const tools = new AppTools({ mcp, webEnabled: true, searchFn: async () => [{ title: 'Official', url: 'https://example.com', snippet: 'Evidence.' }] });
  const result = await tools.call('search_web', { query: 'latest model' });
  await tools.call('search_web', { query: 'verify model' });
  assert.equal(JSON.parse(result.content[0].text).results[0].citation, 1);
  assert.equal(tools.sources.length, 1);
});
test('search tool loops are bounded and cancellation is forwarded', async () => {
  const controller = new AbortController();
  const tools = new AppTools({ mcp, imageSearchFn: async (_query, options) => { assert.equal(options.signal, controller.signal); return []; } });
  for (let i = 0; i < 3; i++) await tools.call('search_images', { query: 'cats' }, { signal: controller.signal });
  await assert.rejects(tools.call('search_images', { query: 'cats' }), /limit reached/);
  controller.abort();
  await assert.rejects(tools.call('search_images', { query: 'cats' }, { signal: controller.signal }), { name: 'AbortError' });
});

test('empty image results do not claim a displayed gallery and provider failure propagates', async () => {
  const empty = new AppTools({ mcp, imageSearchFn: async () => [] });
  const result = JSON.parse((await empty.call('search_images', { query: 'cats' })).content[0].text);
  assert.equal(result.gallery_displayed, false);
  assert.deepEqual(empty.images, []);
  const failed = new AppTools({ mcp, imageSearchFn: async () => { throw new Error('Free credits exhausted'); } });
  await assert.rejects(failed.call('search_images', { query: 'cats' }), /Free credits exhausted/);
  assert.deepEqual(failed.images, []);
});
