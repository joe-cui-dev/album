import type { SignInCodeRecord, SignInCodeStore } from "./sign-in-codes.js";

export const createInMemorySignInCodeStore = (): SignInCodeStore => {
  const records = new Map<string, SignInCodeRecord>();
  const keyOf = ({ email, codeId }: { email: string; codeId: string }) =>
    `${email}\0${codeId}`;

  return {
    async createSignInCode(record) {
      records.set(keyOf(record), { ...record });
    },
    async getSignInCode(input) {
      return records.get(keyOf(input));
    },
    async deleteSignInCode(input) {
      records.delete(keyOf(input));
    },
  };
};
