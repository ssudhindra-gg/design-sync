import { createMockApi } from "./mock/mock-api";
import type { InterviewApi } from "./types";

let instance: InterviewApi | null = null;

/**
 * Single place where the backend implementation is chosen.
 * Swap `createMockApi()` for a REST/WebSocket client that satisfies
 * `InterviewApi` and the whole app moves over with no other edits.
 */
export function getApi(): InterviewApi {
  if (!instance) instance = createMockApi();
  return instance;
}

export * from "./types";
