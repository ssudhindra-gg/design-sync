import { beforeEach, describe, expect, it } from "vitest";

import { forgetMe, recallMe, rememberMe } from "./identity";

describe("identity", () => {
  beforeEach(() => window.localStorage.clear());

  it("remembers who I am in a session", () => {
    rememberMe("s1", "p_1");
    expect(recallMe("s1")).toBe("p_1");
  });

  it("keeps sessions apart", () => {
    rememberMe("s1", "p_1");
    rememberMe("s2", "p_2");
    expect(recallMe("s1")).toBe("p_1");
    expect(recallMe("s2")).toBe("p_2");
  });

  it("forgets one session only", () => {
    rememberMe("s1", "p_1");
    rememberMe("s2", "p_2");
    forgetMe("s1");
    expect(recallMe("s1")).toBeNull();
    expect(recallMe("s2")).toBe("p_2");
  });
});
