import { expect, test } from '@playwright/test';
const base = 'http://127.0.0.1:8000';
const image = { url: 'https://images.example.com/cat.png', thumbnail: 'https://images.example.com/cat.png', source_url: 'https://example.com/cats', title: 'Cat photo', description: 'A cat', source: 'Tavily' };
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test('inline gallery loads, has source links and survives conversation reload', async ({ page }) => {
  await page.route(image.url, route => route.fulfill({ contentType: 'image/png', body: pixel }));
  await page.route(`${base}/conversations`, route => route.fulfill({ json: [{ id: 'image-ui', title: 'Pictures test', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }));
  await page.route(`${base}/conversations/image-ui`, route => route.fulfill({ json: { id: 'image-ui', title: 'Pictures test', messages: [
    { id: 1, role: 'user', content: 'Pictures of cats' }, { id: 2, role: 'assistant', content: 'Here are the pictures.', images: [image] },
  ] } }));
  await page.route(`${base}/chat`, route => route.fulfill({ contentType: 'application/x-ndjson', body: [
    { type: 'conversation', data: { conversation_id: 'image-ui', title: 'Pictures test' } },
    { type: 'image_results', data: [image] }, { type: 'token', data: 'Here are the pictures.' }, { type: 'done', data: { conversation_id: 'image-ui' } },
  ].map(event => JSON.stringify(event)).join('\n') + '\n' }));
  await page.goto('/');
  await page.getByPlaceholder('Ask anything...').fill('Pictures of cats');
  await page.getByRole('button', { name: 'Send message' }).click();
  const gallery = page.getByRole('region', { name: 'Image search results' });
  await expect(gallery).toBeVisible();
  await expect(gallery.getByRole('img', { name: 'A cat' })).toBeVisible();
  await expect(gallery.getByRole('link', { name: 'example.com', exact: true })).toHaveAttribute('href', image.source_url);
  const answer = page.locator('[data-message-role="assistant"] .prose-chat');
  await expect(answer).toContainText('Here are the pictures.');
  expect(await answer.evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector('[aria-label="Image search results"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.getByText('Sources', { exact: true })).toHaveCount(0);
  await page.reload();
  if ((page.viewportSize()?.width || 1440) < 700) await page.getByRole('button', { name: 'Open conversations' }).click();
  await page.locator('button:visible').filter({ hasText: /^Pictures test$/ }).click();
  await expect(gallery.getByRole('img', { name: 'A cat' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});

test('there is no sticky Images mode and a normal question sends no image flag', async ({ page }) => {
  await page.route(`${base}/chat`, async route => {
    expect(route.request().postDataJSON().image_search_enabled).toBeUndefined();
    await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'token', data: 'A normal text answer.' })}\n${JSON.stringify({ type: 'done', data: { conversation_id: null } })}\n` });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Image search', exact: true })).toHaveCount(0);
  await page.getByPlaceholder('Ask anything...').fill("what's Anthropic's latest model?");
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('A normal text answer.', { exact: true })).toBeVisible();
});

test('real picture request displays actual searched images with Web off', async ({ page, request }) => {
  test.setTimeout(120000);
  let id: string | undefined;
  page.on('response', async response => {
    if (response.url() === `${base}/chat`) {
      const text = await response.text().catch(() => '');
      id = text.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(event => event.type === 'conversation')?.data.conversation_id;
    }
  });
  try {
    await page.goto('/');
    const web = page.getByRole('switch', { name: 'Web search' });
    if (await web.getAttribute('aria-checked') === 'true') await web.click();
    await page.getByPlaceholder('Ask anything...').fill('can you bring up pictures of megan fox?');
    await page.getByRole('button', { name: 'Send message' }).click();
    const gallery = page.getByRole('region', { name: 'Image search results' });
    await expect(gallery).toBeVisible({ timeout: 40000 });
    await expect.poll(async () => gallery.locator('img').evaluateAll(elements => elements.filter(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0).length), { timeout: 30000 }).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Stop generating' })).toHaveCount(0, { timeout: 60000 });
    await expect(page.locator('.prose-chat')).not.toContainText('returned 400');
    await expect(page.locator('.prose-chat')).not.toContainText('cannot display');
    const message = await (await request.get(`${base}/conversations/${id}`)).json();
    expect(message.messages.at(-1).images.length).toBeGreaterThan(0);
    expect(message.messages.at(-1).tool_activity.some((event: { type: string; data: { name: string } }) => event.type === 'tool_call' && event.data.name === 'search_images')).toBe(true);
  } finally { if (id) await request.delete(`${base}/conversations/${id}`); }
});
