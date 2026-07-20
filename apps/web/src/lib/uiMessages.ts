export const uiMessages = {
  album: "Album",
  addPhotos: "Add photos",
  archive: "Archive",
  signOut: "Sign out",
  signIn: {
    title: "Open your album",
    description: "Private access for allowed users.",
    email: "Email address",
    requestCode: "Send sign-in code",
    verifyCode: "Verify code",
    code: "Sign-in code",
    useDifferentEmail: "Use a different email",
    requestCodeFirst: "Request a sign-in code first.",
    sendCodeFailed: "Could not send a sign-in code. Try again.",
    verifyCodeFailed: "Could not sign in. Check the code and try again.",
  },
  session: {
    loading: "Opening your album",
    failed: "Your session could not be loaded. Return to sign-in and try again.",
    returnToSignIn: "Return to sign-in",
  },
  emptyAlbum: {
    title: "Your album is empty",
    description: "Add your first photos to begin a timeline.",
    formats: "JPEG, PNG and HEIC",
  },
  emptyArchive: {
    title: "Your archive is empty",
    description: "Archived photos will appear here.",
  },
} as const;
