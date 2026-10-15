import { describe, expect, spyOn, test } from "bun:test";
import { parseArguments, waitForWebhook } from "../infra/git-egress/verify-release";

type Deployment = Awaited<ReturnType<typeof waitForWebhook>>;
const COMMIT = "a1b2c3d4".repeat(5);
const successful: Deployment = {
  deployment_uuid: "production-webhook",
  status: "finished",
  commit: COMMIT,
  is_webhook: true,
  pull_request_id: 0,
  created_at: "2026-10-15T18:00:00Z",
};

async function withApi(
  history: Deployment[],
  detail: Deployment | ((read: number) => Deployment),
  action: (requests: string[]) => Promise<void>,
): Promise<void> {
  const requests: string[] = [], methods: string[] = [];
  let detailReads = 0;
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url.pathname);
    methods.push(init?.method ?? (input instanceof Request ? input.method : "GET"));
    if (url.pathname.includes("/deployments/applications/")) return Response.json({ deployments: history });
    if (url.pathname.endsWith(`/deployments/${successful.deployment_uuid}`)) {
      detailReads++;
      return Response.json(typeof detail === "function" ? detail(detailReads) : detail);
    }
    throw new Error("Unexpected mocked API endpoint");
  }, { preconnect: globalThis.fetch.preconnect }));
  try {
    await action(requests);
    expect(methods.every(method => method === "GET")).toBe(true);
  } finally {
    fetchMock.mockRestore();
  }
}

describe("standalone native release verification", () => {
  test("accepts a full SHA and optional waiting in either argument order", () => {
    expect(parseArguments(["--commit", COMMIT])).toEqual({ commit: COMMIT, wait: false });
    expect(parseArguments(["--commit", COMMIT.toUpperCase(), "--wait"])).toEqual({ commit: COMMIT, wait: true });
    expect(parseArguments(["--wait", "--commit", COMMIT])).toEqual({ commit: COMMIT, wait: true });
  });

  test("rejects symbolic, abbreviated, malformed SHA and extra arguments", () => {
    for (const invalid of ["HEAD", COMMIT.slice(0, 12), "g".repeat(40), `${COMMIT};whoami`]) {
      expect(() => parseArguments(["--commit", invalid])).toThrow();
    }
    for (const invalid of [[], ["--commit"], ["--commit", COMMIT, "--deploy"], ["--commit", COMMIT, "--wait", "--wait"]]) {
      expect(() => parseArguments(invalid)).toThrow();
    }
  });

  test("proves an exact finished production webhook using only GET requests", async () => {
    await withApi([successful], successful, async requests => {
      const proof = await waitForWebhook(COMMIT, false, "fake-test-token");
      expect(proof).toEqual(successful);
      expect(requests).toHaveLength(2);
    });
  });

  test("a successful manual retry cannot prove automatic delivery", async () => {
    const manual = { ...successful, is_webhook: false };
    await withApi([manual], manual, async requests => {
      await expect(waitForWebhook(COMMIT, false, "fake-test-token")).rejects.toThrow();
      expect(requests).toHaveLength(1);
    });
    await withApi([successful], manual, async () => {
      await expect(waitForWebhook(COMMIT, false, "fake-test-token")).rejects.toThrow(/production webhook/i);
    });
  });

  test("a preview build cannot prove the production release", async () => {
    const preview = { ...successful, pull_request_id: 42 };
    await withApi([preview], preview, async () => {
      await expect(waitForWebhook(COMMIT, false, "fake-test-token")).rejects.toThrow();
    });
    await withApi([successful], preview, async () => {
      await expect(waitForWebhook(COMMIT, false, "fake-test-token")).rejects.toThrow(/production webhook/i);
    });
  });

  test("a failed webhook reports failure instead of returning release proof", async () => {
    const failed = { ...successful, status: "failed" };
    await withApi([failed], failed, async requests => {
      await expect(waitForWebhook(COMMIT, false, "fake-test-token")).rejects.toThrow(/deployment.*(?:fail|success)/i);
      expect(requests).toHaveLength(2);
    });
  });

  test("a finished job for another commit cannot satisfy the requested SHA", async () => {
    const other = { ...successful, commit: "b".repeat(40) };
    await withApi([other], other, async requests => {
      await expect(waitForWebhook(COMMIT, false, "fake-test-token")).rejects.toThrow();
      expect(requests).toHaveLength(1);
    });
    await withApi([successful], other, async () => {
      await expect(waitForWebhook(COMMIT, false, "fake-test-token")).rejects.toThrow();
    });
  });

  test("waits through HEAD while queued, then verifies the resolved exact SHA", async () => {
    const queued = { ...successful, commit: "HEAD", status: "queued" };
    const sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined);
    try {
      await withApi([queued], read => read === 1 ? queued : successful, async requests => {
        const proof = await waitForWebhook(COMMIT, true, "fake-test-token");
        expect(proof.commit).toBe(COMMIT);
        expect(proof.status).toBe("finished");
        expect(requests).toHaveLength(4);
        expect(sleep).toHaveBeenCalledTimes(1);
        expect(sleep).toHaveBeenCalledWith(10_000);
      });
    } finally {
      sleep.mockRestore();
    }
  });
});
