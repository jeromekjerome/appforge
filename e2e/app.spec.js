import { test, expect } from '@playwright/test';

test('landing starts the interview and renders a follow-up question', async ({ page }) => {
  await page.route('**/api/chat', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        text: JSON.stringify({
          message: 'How often does this bottleneck happen each week?',
          readyToGenerate: false,
        }),
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Begin the interview/i }).click();
  await expect(page.locator('#chatArea')).toContainText('biggest pain point');

  await page.locator('#chatInput').fill('I lose time rewriting the same patient education handouts.');
  await page.locator('#sendBtn').click();

  await expect(page.locator('#chatArea')).toContainText('How often does this bottleneck happen each week?');
});

test('ready state enables spec generation and shows the result view', async ({ page }) => {
  await page.route('**/api/chat', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        text: JSON.stringify({
          message: 'I have enough to write the spec. Generate it when you are ready.',
          readyToGenerate: true,
        }),
      }),
    });
  });

  await page.route('**/api/generate', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        spec: '# HandoutFlow\n> Turn repetitive patient education into guided templates\n\n## Problem statement\nClinicians keep rewriting the same instructions.',
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Professional/i }).click();
  await page.getByRole('button', { name: /Begin the interview/i }).click();
  await page.locator('#chatInput').fill('Our nurses rewrite discharge guidance all day.');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#generateBtn')).toHaveClass(/visible/);
  await page.locator('#generateBtn').click();

  await expect(page.locator('#result.active')).toBeVisible();
  await expect(page.locator('#specRendered')).toContainText('HandoutFlow');
});

test('lead modal submits the generated spec', async ({ page }) => {
  await page.route('**/api/chat', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        text: JSON.stringify({
          message: 'I have enough to write the spec. Generate it when you are ready.',
          readyToGenerate: true,
        }),
      }),
    });
  });

  await page.route('**/api/generate', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        spec: '# SpecOne\n> Demo spec',
      }),
    });
  });

  let leadPayload;
  await page.route('**/api/leads', async route => {
    leadPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, leadId: 12 }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Begin the interview/i }).click();
  await page.locator('#chatInput').fill('I need a personal habit tracker.');
  await page.locator('#sendBtn').click();
  await page.locator('#generateBtn').click();
  await page.getByRole('button', { name: /Have it built/i }).click();
  await page.locator('#leadName').fill('Jane Builder');
  await page.locator('#leadEmail').fill('jane@example.com');
  await page.locator('#modalSubmit').click();

  await expect(page.locator('#modalSuccess')).toContainText("We've got your spec");
  expect(leadPayload.email).toBe('jane@example.com');
  expect(leadPayload.specMarkdown).toContain('SpecOne');
});
