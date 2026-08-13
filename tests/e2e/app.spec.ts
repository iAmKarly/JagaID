import { test, expect, Page, TestInfo } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

// ── Shared helpers ─────────────────────────────────────────────────────────────
const searchInput = (page: Page) => page.locator("[data-testid='search-input']");
const searchBtn = (page: Page) => page.locator("[data-testid='search-btn']");

/**
 * Type into search and click. Waits for result-card OR result-not-found
 * to appear — meaning the full API round-trip has completed.
 * Never relies on button text (unreliable across different network speeds).
 */
async function doSearch(page: Page, value: string) {
  await searchInput(page).fill(value);
  await searchBtn(page).click();
  await expect(
    page.locator("[data-testid='result-card'], [data-testid='result-not-found']")
  ).toBeVisible({ timeout: 15000 });
}

async function goToTab(page: Page, tab: "lookup" | "report" | "dashboard") {
  await page.locator(`[data-testid='tab-${tab}']`).click();
}

function uniqueReportValue(testInfo: TestInfo) {
  const projectDigits = testInfo.project.name
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0)
    .toString()
    .slice(-3)
    .padStart(3, "0");
  const runDigits = Date.now().toString().slice(-5);
  return `99887766${projectDigits}${testInfo.workerIndex}${testInfo.retry}${runDigits}`;
}

// ── Lookup (CEK) flow ──────────────────────────────────────────────────────────
test.describe("Lookup (CEK) flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await goToTab(page, "lookup");
  });

  test("page loads with search input visible", async ({ page }) => {
    await expect(searchInput(page)).toBeVisible();
  });

  test("searching a known fraudulent account shows BAHAYA TINGGI", async ({ page }) => {
    await doSearch(page, "1234567890");
    await expect(page.locator("[data-testid='risk-label']")).toHaveText("BAHAYA TINGGI");
  });

  test("searching an unknown account shows TIDAK DITEMUKAN", async ({ page }) => {
    await doSearch(page, "0000000000");
    await expect(page.locator("[data-testid='result-not-found']")).toBeVisible();
  });

  test("result shows report count stat", async ({ page }) => {
    await doSearch(page, "1234567890");
    await expect(page.locator("[data-testid='stat-reports']")).toBeVisible();
  });

  test("network connections are shown for connected entity", async ({ page }) => {
    await doSearch(page, "1234567890");
    await expect(page.locator("[data-testid='network-section']")).toBeVisible();
  });

  test("example badge auto-fills search input", async ({ page }) => {
    await page.locator("[data-testid='example-badge']").first().click();
    await expect(searchInput(page)).not.toHaveValue("");
  });

  test("pressing Enter triggers search", async ({ page }) => {
    await searchInput(page).click();
    await searchInput(page).fill("1234567890");
    await expect(searchInput(page)).toHaveValue("1234567890");
    await searchInput(page).press("Enter");
    await expect(
      page.locator("[data-testid='result-card'], [data-testid='result-not-found']")
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-testid='result-card']")).toBeVisible();
    await expect(page.locator("[data-testid='risk-label']")).toHaveText("BAHAYA TINGGI");
  });

  test("TIDAK DITEMUKAN has a report-anyway button", async ({ page }) => {
    await doSearch(page, "0000000000");
    await expect(page.locator("[data-testid='result-not-found']")).toBeVisible();
    await expect(page.locator("[data-testid='btn-report-anyway']")).toBeVisible();
  });
});

// ── Report (LAPOR) flow ────────────────────────────────────────────────────────
test.describe("Report (LAPOR) flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await goToTab(page, "report");
  });

  test("report form is visible", async ({ page }) => {
    await expect(page.locator("[data-testid='report-form']")).toBeVisible();
  });

  test("submitting empty form shows validation error", async ({ page }) => {
    await page.locator("[data-testid='btn-submit-report']").click();
    await expect(page.locator("[data-testid='report-error']")).toBeVisible();
  });

  test("submitting valid report shows success confirmation", async ({
    page,
  }, testInfo) => {
    await page.locator("[data-testid='select-entity-type']").selectOption("bank_account");
    await page
      .locator("[data-testid='input-entity-value']")
      .fill(uniqueReportValue(testInfo));
    await page.locator("[data-testid='select-bank']").selectOption("BCA");
    await page
      .locator("[data-testid='textarea-description']")
      .fill(
        "Pelaku mengaku penjual HP second lalu menghilang setelah menerima transfer."
      );
    await page.locator("[data-testid='btn-submit-report']").click();
    await expect(page.locator("[data-testid='report-success']")).toBeVisible({
      timeout: 12000,
    });
  });

  test("bank selector appears for bank_account type", async ({ page }) => {
    await page.locator("[data-testid='select-entity-type']").selectOption("bank_account");
    await expect(page.locator("[data-testid='select-bank']")).toBeVisible();
  });

  test("bank selector hidden for phone type", async ({ page }) => {
    await page.locator("[data-testid='select-entity-type']").selectOption("phone");
    await expect(page.locator("[data-testid='select-bank']")).not.toBeVisible();
  });

  test("bank selector hidden for ewallet type", async ({ page }) => {
    await page.locator("[data-testid='select-entity-type']").selectOption("ewallet");
    await expect(page.locator("[data-testid='select-bank']")).not.toBeVisible();
  });
});

// ── Dashboard (DATA) flow ──────────────────────────────────────────────────────
test.describe("Dashboard (DATA) flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await goToTab(page, "dashboard");
  });

  test("shows total reports stat card", async ({ page }) => {
    await expect(page.locator("[data-testid='stat-total-reports']")).toBeVisible();
  });

  test("shows high-risk count stat card", async ({ page }) => {
    await expect(page.locator("[data-testid='stat-high-risk']")).toBeVisible();
  });

  test("shows fraud distribution section", async ({ page }) => {
    await expect(page.locator("[data-testid='distribution-section']")).toBeVisible();
  });

  test("shows top dangerous entities list", async ({ page }) => {
    await expect(page.locator("[data-testid='entity-row']").first()).toBeVisible({
      timeout: 8000,
    });
  });

  test("clicking entity row navigates to CEK tab and shows result", async ({ page }) => {
    await expect(page.locator("[data-testid='entity-row']").first()).toBeVisible({
      timeout: 8000,
    });
    await page.locator("[data-testid='entity-row']").first().click();
    await expect(
      page.locator("[data-testid='result-card'], [data-testid='result-not-found']")
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-testid='result-card']")).toBeVisible();
  });

  test("API preview block is visible", async ({ page }) => {
    await expect(page.locator("[data-testid='api-preview']")).toBeVisible();
  });
});

// ── Navigation ─────────────────────────────────────────────────────────────────
test.describe("Navigation", () => {
  test("all three tabs render their main content", async ({ page }) => {
    await page.goto(BASE);
    await goToTab(page, "report");
    await expect(page.locator("[data-testid='report-form']")).toBeVisible();
    await goToTab(page, "dashboard");
    await expect(page.locator("[data-testid='stat-total-reports']")).toBeVisible();
    await goToTab(page, "lookup");
    await expect(searchInput(page)).toBeVisible();
  });

  test("tab switch clears previous lookup result", async ({ page }) => {
    await page.goto(BASE);
    await goToTab(page, "lookup");
    await doSearch(page, "1234567890");
    await expect(page.locator("[data-testid='result-card']")).toBeVisible();
    // Switch away and back — result must be cleared
    await goToTab(page, "report");
    await goToTab(page, "lookup");
    await expect(page.locator("[data-testid='result-card']")).not.toBeVisible();
    await expect(page.locator("[data-testid='result-not-found']")).not.toBeVisible();
  });
});

// ── Admin Upload (/admin/upload) ───────────────────────────────────────────────
test.describe("Admin Upload (/admin/upload)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/admin/upload`);
  });

  test("page loads with admin key input visible", async ({ page }) => {
    await expect(page.locator("[data-testid='input-admin-key']")).toBeVisible();
  });

  test("download template button is present", async ({ page }) => {
    await expect(page.locator("[data-testid='btn-download-template']")).toBeVisible();
  });

  test("upload button is disabled without a file", async ({ page }) => {
    await expect(page.locator("[data-testid='btn-upload']")).toBeDisabled();
  });

  test("drop zone is visible", async ({ page }) => {
    await expect(page.locator("[data-testid='drop-zone']")).toBeVisible();
  });

  test("reset database button is visible", async ({ page }) => {
    await expect(page.locator("[data-testid='btn-reset']")).toBeVisible();
  });

  test("clicking reset shows confirmation, clicking confirm without key shows alert", async ({
    page,
  }) => {
    await page.locator("[data-testid='btn-reset']").click();
    await expect(page.locator("[data-testid='btn-reset-confirm']")).toBeVisible();
    page.on("dialog", async (dialog) => {
      expect(dialog.message().toLowerCase()).toContain("admin key");
      await dialog.accept();
    });
    await page.locator("[data-testid='btn-reset-confirm']").click();
  });

  test("cancel button dismisses reset confirmation", async ({ page }) => {
    await page.locator("[data-testid='btn-reset']").click();
    await expect(page.locator("[data-testid='btn-reset-confirm']")).toBeVisible();
    await page.locator("[data-testid='btn-reset-cancel']").click();
    await expect(page.locator("[data-testid='btn-reset']")).toBeVisible();
    await expect(page.locator("[data-testid='btn-reset-confirm']")).not.toBeVisible();
  });

  test("workflow section is visible", async ({ page }) => {
    await expect(page.locator("[data-testid='workflow-section']")).toBeVisible();
  });
});
