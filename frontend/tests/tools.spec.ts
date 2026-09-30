import { expect, test } from '@playwright/test';
const base = 'http://127.0.0.1:8000';

test('tool details render and survive conversation reload', async ({ page }) => {
  const toolEvents = [
    { type: 'tool_call', data: { id: 'call_1', name: 'workspace__read_file', arguments: { path: 'welcome.txt' } } },
    { type: 'tool_result', data: { id: 'call_1', name: 'workspace__read_file', isError: false, summary: 'Verified fixture result' } },
  ];
  await page.route(`${base}/conversations/tool-ui`, route => route.fulfill({ json: {
    id: 'tool-ui', title: 'Tool test', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    messages: [{ id: 1, role: 'user', content: 'Read welcome' }, { id: 2, role: 'assistant', content: 'Read successfully.', tool_activity: toolEvents }],
  } }));
  await page.route(`${base}/conversations`, route => route.fulfill({ json: [{ id: 'tool-ui', title: 'Tool test', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }));
  await page.route(`${base}/chat`, route => route.fulfill({ contentType: 'application/x-ndjson', body: [
    { type: 'conversation', data: { conversation_id: 'tool-ui', title: 'Tool test' } }, ...toolEvents,
    { type: 'token', data: 'Read successfully.' }, { type: 'done', data: { conversation_id: 'tool-ui' } },
  ].map(event => JSON.stringify(event)).join('\n') + '\n' }));
  await page.goto('/');
  await page.getByPlaceholder('Ask anything...').fill('Read welcome');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Read successfully.')).toBeVisible();
  await page.getByText('Tools used (1)').click();
  await expect(page.getByText('Verified fixture result')).toBeVisible();
  await page.reload();
  if ((page.viewportSize()?.width || 1440) < 700) await page.getByRole('button', { name: 'Open conversations' }).click();
  await page.locator('button:visible').filter({ hasText: /^Tool test$/ }).click();
  await page.getByText('Tools used (1)').click();
  await expect(page.getByText('Verified fixture result')).toBeVisible();
  await expect(page.getByText('workspace / read_file · Done')).toBeVisible();
});

test('real local Qwen uses MCP and the result is saved', async ({ page, request }) => {
  test.setTimeout(120000);
  let id: string | undefined;
  page.on('response', async response => {
    if (response.url() === `${base}/chat`) {
      const text = await response.text().catch(() => '');
      const event = text.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(event => event.type === 'conversation');
      id = event?.data.conversation_id;
    }
  });
  try {
    await page.goto('/');
    await page.getByPlaceholder('Ask anything...').fill('Use the actual workspace tools to list files, then read welcome.txt and tell me which GPU Bonfire uses. Keep it to one sentence.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('[data-message-role="assistant"] .prose-chat').getByText(/RX 6600 XT/)).toBeVisible({ timeout: 90000 });
    await expect(page.getByRole('button', { name: 'Stop generation' })).toHaveCount(0, { timeout: 30000 });
    await expect(page.getByText(/Tools used \([2-9]\)/)).toBeVisible();
    await page.getByText(/Tools used \([2-9]\)/).click();
    await expect(page.getByText('workspace / list_files · Done')).toBeVisible();
    await expect(page.getByText('workspace / read_file · Done')).toBeVisible();
  } finally { if (id) await request.delete(`${base}/conversations/${id}`); }
});
