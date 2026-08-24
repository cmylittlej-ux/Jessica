import { expect, test, type Page } from '@playwright/test';

/**
 * Mandatory E2E scenarios (Hardening Spec §32–§38), driven through the real
 * UI against the real database and workflow engine. The simulator submits a
 * RAW email (from/to/subject/body) — entity resolution is done by the system:
 * no test ever pre-selects a contact, property or case (§7, §32).
 *
 *   A (§32) Raw email full chain: tenant report → contact/property/case match
 *           → MAINTENANCE case → bilingual reply → edit & approve → mock send
 *           → SENT + zh translation stored (§38 asserted here too).
 *   B (§33) Multiple maintenance cases at one property: "hot water" email must
 *           link the HOT WATER case, never the dishwasher case.
 *   C (§34) Low confidence with existing cases: vague email held for manual
 *           triage — an existing same-type case can never rescue it.
 *   D (§35) AI failure: provider forced to throw → message preserved,
 *           READY_FOR_REVIEW, AI_FAILED activity, no approval, nothing sent.
 *   F (§36) Duplicate message: identical raw email twice → one Communication,
 *           idempotent no-op.
 *
 * (§37 duplicate-send idempotency is covered as an integration DB test in
 * tests/integration/hardening.db.spec.ts — it has no UI surface by design.)
 */

const UNIQUE = () => Date.now().toString(36);

async function simulateRawEmail(
  page: Page,
  input: { from: string; subject: string; body: string; forceFailure?: boolean },
): Promise<void> {
  await page.goto('/inbox');
  await page.getByTestId('sim-from').fill(input.from);
  await page.getByTestId('sim-subject').fill(input.subject);
  await page.getByTestId('sim-body').fill(input.body);
  if (input.forceFailure) {
    // The debug override lives inside a collapsed <details> block.
    await page.getByText('Advanced test overrides').click();
    await page.getByTestId('sim-force-failure').check();
  }
  await page.getByTestId('sim-submit').click();
}

test.describe.serial('Mandatory hardening E2E scenarios', () => {
  // -----------------------------------------------------------------------
  // A (§32 + §38) — Raw email full chain, no pre-filled entities.
  // -----------------------------------------------------------------------
  test('A — raw email: auto match → classify → case+task → edit & approve → mock send → zh translation', async ({
    page,
  }) => {
    const subject = `Dishwasher not working ${UNIQUE()}`;
    await simulateRawEmail(page, {
      from: 'tenant1@example.com',
      subject,
      body: 'Hi Neil, the dishwasher at our place is broken and not working. Could you please arrange a repair? Thanks, Alex',
    });

    // High-confidence maintenance → automation ran → approval pending.
    const item = page.locator('a', { hasText: subject }).first();
    await expect(item).toBeVisible();
    await expect(item.getByText('AWAITING APPROVAL')).toBeVisible();

    await item.click();
    await expect(page).toHaveURL(/\/inbox\/com_/);

    // Four-dimensional classification persisted and surfaced.
    await expect(page.getByText('MAINTENANCE').first()).toBeVisible();
    await expect(page.getByText('AI Summary')).toBeVisible();

    // §38: Original English preserved AND Chinese translation stored separately.
    await expect(page.getByText('[中译]').first()).toBeVisible();

    // Bilingual reply draft behind the only path to an external effect.
    await expect(page.getByText('AI Reply Draft')).toBeVisible();
    await page.getByText('Edit before approving').click();
    await page
      .locator('textarea[name="bodyEn"]')
      .fill('Thanks for letting us know. A technician will contact you within one business day.');
    await page.locator('textarea[name="bodyZh"]').fill('感谢您的来信。维修技师将在一个工作日内与您联系。');
    await page.getByRole('button', { name: 'Save edit, Approve & Mock Send' }).click();
    await expect(page.getByText('EMAIL_SENT')).toBeVisible();
  });

  // -----------------------------------------------------------------------
  // B (§33) — Two open maintenance cases at prp_901 (dishwasher / hot water).
  // The matcher must pick the hot-water case from content evidence alone.
  // -----------------------------------------------------------------------
  test('B — multiple maintenance cases: hot water email targets the hot water case', async ({
    page,
  }) => {
    const subject = `Hot water unit still leaking ${UNIQUE()}`;
    await simulateRawEmail(page, {
      from: 'tenant1@example.com',
      subject,
      body: 'The hot water unit is still leaking since yesterday. There is water pooling in the garage. Please help soon.',
    });

    const item = page.locator('a', { hasText: subject }).first();
    await expect(item).toBeVisible();
    await item.click();

    // Linked case must be cas_902 ("Hot water system failure") — NOT cas_901.
    const caseLink = page.locator('a', { hasText: 'Hot water system failure' }).first();
    await expect(caseLink).toBeVisible();
    await expect(page.locator('a', { hasText: 'Dishwasher failure' })).toHaveCount(0);
  });

  // -----------------------------------------------------------------------
  // C (§34) — Low confidence must hold even though open cases exist at the
  // sender's property. Existing Maintenance Case #1 can NEVER rescue it.
  // -----------------------------------------------------------------------
  test('C — low confidence with existing cases: held for review, nothing auto-linked', async ({
    page,
  }) => {
    const subject = `Quick question ${UNIQUE()}`;
    await simulateRawEmail(page, {
      from: 'tenant1@example.com',
      subject,
      body: 'Hi Neil, any update?',
    });

    const item = page.locator('a', { hasText: subject }).first();
    await expect(item).toBeVisible();
    // No approval badge — low confidence blocks ALL automation.
    await expect(item.getByText('AWAITING APPROVAL')).toHaveCount(0);

    await item.click();
    // Held case: READY_FOR_REVIEW, unclassified domain, manual triage entry.
    await expect(page.getByText('READY FOR REVIEW')).toBeVisible();
    await expect(page.getByText('OTHER_ADMIN').first()).toBeVisible();

    await page.locator('a[href^="/cases/"]').first().click();
    await expect(page.getByText('UNKNOWN')).toBeVisible();
    await expect(page.getByText('NEEDS_MANUAL_CLASSIFICATION')).toBeVisible();
    await expect(page.getByText(/Low confidence/).first()).toBeVisible();
  });

  // -----------------------------------------------------------------------
  // D (§35) — AI failure injection: safe degradation, nothing executed.
  // -----------------------------------------------------------------------
  test('D — AI provider failure: message preserved, READY_FOR_REVIEW, no external action', async ({
    page,
  }) => {
    const subject = `Garage door stuck ${UNIQUE()}`;
    await simulateRawEmail(page, {
      from: 'tenant1@example.com',
      subject,
      body: 'The garage door is stuck half open and will not close. This is urgent.',
      forceFailure: true,
    });

    const item = page.locator('a', { hasText: subject }).first();
    await expect(item).toBeVisible();
    // No automation happened at all.
    await expect(item.getByText('AWAITING APPROVAL')).toHaveCount(0);

    await item.click();
    await expect(page.getByText('READY FOR REVIEW')).toBeVisible();

    // Technical trail exists on the holding case: AI_FAILED activity.
    await page.locator('a[href^="/cases/"]').first().click();
    await expect(page.getByText('AI_FAILED').first()).toBeVisible();
  });

  // -----------------------------------------------------------------------
  // F (§36) — Duplicate message: the same raw email ingested twice creates
  // exactly ONE communication; the second pass is an idempotent no-op.
  // -----------------------------------------------------------------------
  test('F — duplicate raw email: second ingest is a no-op, still one inbox item', async ({
    page,
  }) => {
    const payload = {
      from: 'tenant1@example.com',
      subject: 'Oven light not working',
      body: 'The oven light bulb needs replacing. Everything else works fine.',
    };

    await simulateRawEmail(page, payload);
    await page.goto('/inbox');
    await expect(page.locator('a', { hasText: payload.subject })).toHaveCount(1);

    // Exact same raw email again → deduped on (source, account, messageId hash).
    await simulateRawEmail(page, payload);
    await page.goto('/inbox');
    await expect(page.locator('a', { hasText: payload.subject })).toHaveCount(1);
  });
});
