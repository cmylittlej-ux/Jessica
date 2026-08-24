import { expect, test, type Page } from '@playwright/test';

/**
 * Mandatory E2E scenarios (Spec §32-34), driven through the real UI against
 * the real database and workflow engine — no mocks beyond the AI provider
 * itself. Run serially against a deterministic seed (see global-setup.ts).
 *
 *   A — Maintenance:  tenant report → MAINTENANCE case → edit Chinese final →
 *                     approve → mock send → SENT + Timeline + AuditLog
 *   B — Sales Offer:  $385k offer → SALES/OFFER HIGH DECISION_REQUIRED →
 *                     buyer acknowledgement drafted → vendor review task →
 *                     approve → sent (never auto-accepted)
 *   C — Low Confidence: vague email → READY_FOR_REVIEW human triage hold,
 *                     no fabricated relations, NEEDS_MANUAL_CLASSIFICATION
 */

const UNIQUE = () => Date.now().toString(36);

async function simulateInbound(
  page: Page,
  subject: string,
  body: string,
): Promise<void> {
  await page.goto('/inbox');
  await page.getByTestId('sim-property').selectOption({ index: 1 });
  await page.getByTestId('sim-sender').selectOption({ index: 1 });
  await page.getByTestId('sim-subject').fill(subject);
  await page.getByTestId('sim-body').fill(body);
  await page.getByTestId('sim-submit').click();
  // The workflow runs synchronously inside the server action; when the list
  // re-renders our new message is at the top (receivedAt desc).
  await expect(page.locator('a', { hasText: subject }).first()).toBeVisible();
}

test.describe.serial('Mandatory E2E scenarios', () => {
  test('A — Maintenance full chain: classify → case+task → edit & approve → mock send', async ({
    page,
  }) => {
    const subject = `Dishwasher not working ${UNIQUE()}`;
    await simulateInbound(
      page,
      subject,
      'Hi, the dishwasher in the kitchen is broken and not working. Could you please arrange a repair? Thanks.',
    );

    // Workflow outcome: high-confidence maintenance → awaiting approval badge.
    const item = page.locator('a', { hasText: subject }).first();
    await expect(item.getByText('AWAITING APPROVAL')).toBeVisible();

    await item.click();
    await expect(page).toHaveURL(/\/inbox\/com_sim_/);

    // System identified domain/case type and produced a bilingual summary +
    // bilingual reply draft behind an approval.
    await expect(page.getByText('MAINTENANCE').first()).toBeVisible();
    await expect(page.getByText('AI Summary')).toBeVisible();
    await expect(page.getByText('AI Reply Draft')).toBeVisible();
    await expect(page.getByText('English (sending version)')).toBeVisible();
    await expect(page.getByText('中文草稿')).toBeVisible();

    // User edits the reply (keeps AI original + human final + EDITED feedback)
    // then approves — the only path to an external effect.
    await page.getByText('Edit before approving').click();
    await page
      .locator('textarea[name="bodyEn"]')
      .fill('Thanks for letting us know. A technician will contact you within one business day.');
    await page
      .locator('textarea[name="bodyZh"]')
      .fill('感谢您的来信。维修技师将在一个工作日内与您联系。');
    await page.getByRole('button', { name: 'Save edit, Approve & Mock Send' }).click();

    // Mock send executed: SENT communication recorded on the timeline.
    await expect(page.getByText('EMAIL_SENT')).toBeVisible();
  });

  test('B — Sales Offer: SALES/OFFER HIGH decision required, acknowledgement sent, never auto-accepted', async ({
    page,
  }) => {
    const subject = `Offer $385,000 ${UNIQUE()}`;
    await simulateInbound(
      page,
      subject,
      'Our buyer would like to submit an offer of $385,000 subject to finance condition and 45-day settlement.',
    );

    const item = page.locator('a', { hasText: subject }).first();
    await expect(item.getByText('AWAITING APPROVAL')).toBeVisible();

    await item.click();
    // Spec §33: system identifies SALES / OFFER / HIGH.
    await expect(page.getByText('OFFER', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('HIGH').first()).toBeVisible();
    await expect(page.getByText('AI Reply Draft')).toBeVisible();

    // Follow-up (vendor review) task was created on the case.
    await page.locator('a[href^="/cases/"]').first().click();
    await expect(page.getByText(/Follow up:/).first()).toBeVisible();
    await expect(page.getByText('SALES')).toBeVisible();

    // Approve sends the buyer acknowledgement only — the offer decision stays
    // with the vendor (no auto-acceptance anywhere in the flow).
    await page.goBack();
    await page.getByRole('button', { name: 'Approve & Mock Send' }).click();
    await expect(page.getByText('EMAIL_SENT')).toBeVisible();
  });

  test('C — Low Confidence: vague email held for manual triage, nothing fabricated', async ({
    page,
  }) => {
    const subject = `Quick question ${UNIQUE()}`;
    await simulateInbound(page, subject, 'Hi Neil, any update?');

    // No approval badge — confidence below threshold blocks automation.
    const item = page.locator('a', { hasText: subject }).first();
    await expect(item.getByText('AWAITING APPROVAL')).toHaveCount(0);

    await item.click();
    // Held case: READY_FOR_REVIEW, no fabricated classification.
    // (Badges render underscores as spaces.)
    await expect(page.getByText('READY FOR REVIEW')).toBeVisible();
    // The Classification field renders the raw enum code.
    await expect(page.getByText('OTHER_ADMIN').first()).toBeVisible();

    // Case-level view: UNKNOWN domain chip + manual-triage timeline entry,
    // and no auto-established people/tasks/reply automation.
    await page.locator('a[href^="/cases/"]').first().click();
    await expect(page.getByText('UNKNOWN')).toBeVisible();
    await expect(page.getByText('NEEDS_MANUAL_CLASSIFICATION')).toBeVisible();
    await expect(page.getByText('Low confidence')).toBeVisible();
  });
});
