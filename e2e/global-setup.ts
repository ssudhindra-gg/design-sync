import { compose, EXTERNAL_URL, waitUntilServing } from "./stack";

export default async function globalSetup(): Promise<void> {
  if (EXTERNAL_URL) {
    await waitUntilServing();
    return;
  }
  // Clear anything a previous, interrupted run left behind.
  compose("down", "-v", "--remove-orphans");
  try {
    compose("up", "-d", "--build");
    await waitUntilServing();
  } catch (error) {
    // Don't leave a half-started stack behind for globalTeardown to maybe miss.
    compose("down", "-v", "--remove-orphans");
    throw error;
  }
}
