export default function NextAuth(config) {
  globalThis.__DIFF_NEXTAUTH_CONFIG = config;
  return {
    handlers: {},
    auth: async () => null,
    signIn: async () => {
      throw new Error('diff harness does not start the network sign-in flow');
    },
    signOut: async () => {},
  };
}
