import { createRealApi } from "./real-api";
import type { InterviewApi } from "./types";

let instance: InterviewApi | null = null;

/**
 * Single place where the backend implementation is chosen.
 * Keep the implementation choice in one place so the UI only depends on the
 * transport-agnostic InterviewApi contract.
 */
export function getApi(): InterviewApi {
  if (!instance) instance = createRealApi();
  return instance;
}

export * from "./types";
