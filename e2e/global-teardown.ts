import { compose, EXTERNAL_URL } from "./stack";

export default async function globalTeardown(): Promise<void> {
  if (EXTERNAL_URL) return;
  compose("down", "-v", "--remove-orphans");
}
