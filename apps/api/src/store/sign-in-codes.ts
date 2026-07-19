export interface SignInCodeRecord {
  email: string;
  codeId: string;
  userId: string;
  codeHash: string;
  createdAt: string;
  expiresAt: number;
}

export interface SignInCodeStore {
  createSignInCode(record: SignInCodeRecord): Promise<void>;
  getSignInCode(input: {
    email: string;
    codeId: string;
  }): Promise<SignInCodeRecord | undefined>;
  deleteSignInCode(input: { email: string; codeId: string }): Promise<void>;
}
