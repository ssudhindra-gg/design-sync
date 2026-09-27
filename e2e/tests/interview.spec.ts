import { expect, test, type Browser, type BrowserContext } from "@playwright/test";

// Separate contexts have separate cookies and localStorage: two people, two
// browsers.
async function newPerson(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
}

test("a candidate's canvas change reaches the interviewer live", async ({ browser, baseURL }) => {
  const interviewerContext = await newPerson(browser);
  const candidateContext = await newPerson(browser);
  const interviewer = await interviewerContext.newPage();
  const candidate = await candidateContext.newPage();

  // 1-2. There is no login screen: creating a room logs the frontend in as the
  // demo interviewer account built into the bundle, then creates the session.
  await interviewer.goto("/");
  await interviewer.getByLabel("Session name").fill("E2E system design interview");
  await interviewer.getByLabel("Your name").fill("Alex Interviewer");
  const loggedIn = interviewer.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
  await interviewer.getByRole("button", { name: "Create interview room" }).click();
  expect((await loggedIn).status()).toBe(200);

  await interviewer.waitForURL(/\/room\/[^/]+$/);
  const sessionId = new URL(interviewer.url()).pathname.split("/").pop()!;

  // 3. Share the join link through the clipboard, as the interviewer would.
  await interviewer.getByRole("button", { name: "Share link" }).click();
  await expect(interviewer.getByText("Private join link copied")).toBeVisible();
  const joinLink = await interviewer.evaluate(() => navigator.clipboard.readText());
  expect(joinLink).toBe(`${baseURL}/join/${sessionId}`);

  // 4. The candidate opens the link in their own browser and asks to join...
  await candidate.goto(joinLink);
  await expect(candidate.getByRole("heading", { name: "E2E system design interview" })).toBeVisible();
  await candidate.getByLabel("Display name").fill("Priya Candidate");
  await candidate.getByRole("button", { name: "Ask to join" }).click();
  await expect(candidate.getByRole("heading", { name: "Waiting to be admitted" })).toBeVisible();

  // ...and is let in, after which their page moves into the room by itself.
  const waitingRow = interviewer.getByRole("listitem").filter({ hasText: "Priya Candidate" });
  await waitingRow.getByRole("button", { name: "Admit" }).click();
  await candidate.waitForURL(`**/room/${sessionId}`);

  // 5. The candidate adds a component to the canvas from the palette.
  const addService = candidate.getByRole("button", { name: "Service", exact: true });
  await expect(addService).toBeEnabled();
  await addService.click();
  await expect(candidate.getByText("Service 1", { exact: true })).toBeVisible();

  // 6. The interviewer sees it without reloading, so it arrived over the
  // WebSocket rather than from a fresh fetch.
  await expect(interviewer.getByText("Service 1", { exact: true })).toBeVisible();

  await interviewerContext.close();
  await candidateContext.close();
});
