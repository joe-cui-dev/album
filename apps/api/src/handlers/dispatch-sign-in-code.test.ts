import { createInMemorySignInChallengeStore } from "../store/in-memory-sign-in-challenge-store.js";
import { deriveSignInCode } from "../sign-in-code-crypto.js";
import { handleDispatchBatch } from "./dispatch-sign-in-code.js";

const record = (body: unknown, messageId = "message-1") => ({ messageId, body: JSON.stringify(body) });

describe("handleDispatchBatch", () => {
  it("is a silent no-op for a non-allowlisted Email -- no store write, no email sent", async () => {
    const signInChallenges = createInMemorySignInChallengeStore();
    const sent: unknown[] = [];
    const response = await handleDispatchBatch({
      records: [record({ requestId: "request-1", email: "stranger@example.com" })],
      deps: { signInChallenges, now: () => new Date("2026-07-19T00:00:00.000Z"), sendSignInCodeEmail: async (input) => { sent.push(input); } },
    });
    expect(response.batchItemFailures).toEqual([]);
    expect(sent).toEqual([]);
    // No store write means a fresh dispatch for this Email is unblocked by any cooldown.
    await expect(
      signInChallenges.tryDispatch({ email: "stranger@example.com", requestId: "probe", codeHash: "hash", now: new Date("2026-07-19T00:00:00.000Z"), codeTtlSeconds: 600 }),
    ).resolves.toEqual({ dispatched: true });
  });

  it("dispatches the derived Code for an Allowed Email and sends it", async () => {
    const signInChallenges = createInMemorySignInChallengeStore();
    const sent: unknown[] = [];
    const code = deriveSignInCode("request-1");
    await handleDispatchBatch({
      records: [record({ requestId: "request-1", email: "USER@EXAMPLE.COM" })],
      deps: { signInChallenges, now: () => new Date("2026-07-19T00:00:00.000Z"), sendSignInCodeEmail: async (input) => { sent.push(input); } },
    });
    expect(sent).toEqual([{ email: "user@example.com", code }]);
    // A redelivery of the same requestId is only resent if it's the active Challenge.
    await expect(
      signInChallenges.tryDispatch({ email: "user@example.com", requestId: "request-1", codeHash: "irrelevant-for-redelivery", now: new Date("2026-07-19T00:00:00.000Z"), codeTtlSeconds: 600 }),
    ).resolves.toEqual({ dispatched: true });
  });

  it("resends the identical Code for a redelivered message without consuming another rate slot", async () => {
    const signInChallenges = createInMemorySignInChallengeStore();
    const sent: Array<{ email: string; code: string }> = [];
    const deps = { signInChallenges, now: () => new Date("2026-07-19T00:00:00.000Z"), sendSignInCodeEmail: async (input: { email: string; code: string }) => { sent.push(input); } };
    await handleDispatchBatch({ records: [record({ requestId: "request-1", email: "user@example.com" })], deps });
    await handleDispatchBatch({ records: [record({ requestId: "request-1", email: "user@example.com" })], deps });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
  });

  it("does not resend a redelivered message once its Code has expired", async () => {
    const signInChallenges = createInMemorySignInChallengeStore();
    const sent: Array<{ email: string; code: string }> = [];
    const deps = { signInChallenges, now: () => new Date("2026-07-19T00:00:00.000Z"), sendSignInCodeEmail: async (input: { email: string; code: string }) => { sent.push(input); } };
    await handleDispatchBatch({ records: [record({ requestId: "request-1", email: "user@example.com" })], deps });
    const laterDeps = { ...deps, now: () => new Date("2026-07-19T00:10:01.000Z") };
    const response = await handleDispatchBatch({ records: [record({ requestId: "request-1", email: "user@example.com" })], deps: laterDeps });
    expect(response.batchItemFailures).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("silently drops a rate-limited send (no email, no thrown error)", async () => {
    const signInChallenges = createInMemorySignInChallengeStore();
    const sent: unknown[] = [];
    const deps = { signInChallenges, now: () => new Date("2026-07-19T00:00:00.000Z"), sendSignInCodeEmail: async (input: unknown) => { sent.push(input); } };
    await handleDispatchBatch({ records: [record({ requestId: "request-1", email: "user@example.com" })], deps });
    const response = await handleDispatchBatch({ records: [record({ requestId: "request-2", email: "user@example.com" })], deps });
    expect(response.batchItemFailures).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("isolates a failing record for SQS redelivery without blocking the rest of the batch", async () => {
    const signInChallenges = createInMemorySignInChallengeStore();
    const sent: unknown[] = [];
    const response = await handleDispatchBatch({
      records: [
        { messageId: "bad-message", body: "not valid json" },
        record({ requestId: "request-1", email: "user@example.com" }, "good-message"),
      ],
      deps: { signInChallenges, now: () => new Date("2026-07-19T00:00:00.000Z"), sendSignInCodeEmail: async (input) => { sent.push(input); } },
    });
    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "bad-message" }]);
    expect(sent).toHaveLength(1);
  });
});
