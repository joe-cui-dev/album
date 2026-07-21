import { createInMemorySignInDispatchStore } from "../store/in-memory-sign-in-dispatch-store.js";
import { deriveSignInCode } from "../sign-in-code-crypto.js";
import { handleDispatchBatch } from "./dispatch-sign-in-code.js";

const record = (body: unknown, messageId = "message-1") => ({ messageId, body: JSON.stringify(body) });

describe("handleDispatchBatch", () => {
  it("is a silent no-op for a non-allowlisted Email -- no store write, no email sent", async () => {
    const signInDispatch = createInMemorySignInDispatchStore();
    const sent: unknown[] = [];
    const response = await handleDispatchBatch({
      records: [record({ requestId: "request-1", email: "stranger@example.com" })],
      deps: { signInDispatch, now: () => new Date("2026-07-19T00:00:00.000Z"), sendSignInCodeEmail: async (input) => { sent.push(input); } },
    });
    expect(response.batchItemFailures).toEqual([]);
    expect(sent).toEqual([]);
    await expect(signInDispatch.getActiveCredential("stranger@example.com")).resolves.toBeUndefined();
  });

  it("dispatches the derived Code for an Allowed Email and sends it", async () => {
    const signInDispatch = createInMemorySignInDispatchStore();
    const sent: unknown[] = [];
    const code = deriveSignInCode("request-1");
    await handleDispatchBatch({
      records: [record({ requestId: "request-1", email: "USER@EXAMPLE.COM" })],
      deps: { signInDispatch, now: () => new Date("2026-07-19T00:00:00.000Z"), sendSignInCodeEmail: async (input) => { sent.push(input); } },
    });
    expect(sent).toEqual([{ email: "user@example.com", code }]);
    await expect(signInDispatch.getActiveCredential("user@example.com")).resolves.toMatchObject({ requestId: "request-1" });
  });

  it("resends the identical Code for a redelivered message without consuming another rate slot", async () => {
    const signInDispatch = createInMemorySignInDispatchStore();
    const sent: Array<{ email: string; code: string }> = [];
    const deps = { signInDispatch, now: () => new Date("2026-07-19T00:00:00.000Z"), sendSignInCodeEmail: async (input: { email: string; code: string }) => { sent.push(input); } };
    await handleDispatchBatch({ records: [record({ requestId: "request-1", email: "user@example.com" })], deps });
    await handleDispatchBatch({ records: [record({ requestId: "request-1", email: "user@example.com" })], deps });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
  });

  it("silently drops a rate-limited send (no email, no thrown error)", async () => {
    const signInDispatch = createInMemorySignInDispatchStore();
    const sent: unknown[] = [];
    const deps = { signInDispatch, now: () => new Date("2026-07-19T00:00:00.000Z"), sendSignInCodeEmail: async (input: unknown) => { sent.push(input); } };
    await handleDispatchBatch({ records: [record({ requestId: "request-1", email: "user@example.com" })], deps });
    const response = await handleDispatchBatch({ records: [record({ requestId: "request-2", email: "user@example.com" })], deps });
    expect(response.batchItemFailures).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("isolates a failing record for SQS redelivery without blocking the rest of the batch", async () => {
    const signInDispatch = createInMemorySignInDispatchStore();
    const sent: unknown[] = [];
    const response = await handleDispatchBatch({
      records: [
        { messageId: "bad-message", body: "not valid json" },
        record({ requestId: "request-1", email: "user@example.com" }, "good-message"),
      ],
      deps: { signInDispatch, now: () => new Date("2026-07-19T00:00:00.000Z"), sendSignInCodeEmail: async (input) => { sent.push(input); } },
    });
    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "bad-message" }]);
    expect(sent).toHaveLength(1);
  });
});
