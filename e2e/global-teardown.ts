import { compose } from "./stack";

export default async function globalTeardown(): Promise<void> {
  compose("down", "-v", "--remove-orphans");
}
