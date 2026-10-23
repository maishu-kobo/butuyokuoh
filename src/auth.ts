import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { getDb } from '@/lib/db';
import { confirmVerifiedPassword, sessionGenerationMatches, User } from '@/lib/auth';
import { linkGoogleAccount } from '@/lib/link-google-account';
import { googleClientConfig } from '@/lib/google-login';

const google = googleClientConfig();

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    ...(google ? [Google({ clientId: google.clientId, clientSecret: google.clientSecret })] : []),
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const db = getDb();
        const user = db
          .prepare("SELECT * FROM users WHERE email = ? AND account_type = 'member'")
          .get(credentials.email as string) as (User & { password_hash: string | null }) | undefined;

        if (!user || !user.password_hash) {
          return null;
        }

        const sessionGeneration = await confirmVerifiedPassword(
          user.id,
          credentials.password as string,
          user.password_hash
        );
        if (sessionGeneration == null) return null;

        return {
          id: String(user.id),
          email: user.email,
          name: user.name,
          sessionGeneration,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        const googleProfile = profile as { email?: string; email_verified?: boolean } | undefined;
        const email = (googleProfile?.email ?? user.email ?? '').trim().toLowerCase();
        if (!email || email.endsWith('@guest.invalid')) return false;

        const result = linkGoogleAccount(getDb(), {
          email,
          googleId: account.providerAccountId,
          name: user.name || null,
          emailVerified: googleProfile?.email_verified === true,
        });

        if (!result.ok) {
          return false;
        }

        user.id = String(result.userId);
      }
      return true;
    },
    async jwt({ token, user, account }) {
      // Credentials はパスワード確認と同じ読み取りの世代だけを載せる。
      // ここで DB を読み直すと、確認のあと進んだ世代で署名できる。
      if (user?.id && account?.provider === 'credentials') {
        const pinned = user.sessionGeneration;
        if (typeof pinned !== 'number' || !Number.isInteger(pinned) || pinned < 0) {
          delete token.userId;
          delete token.sessionGeneration;
          return token;
        }
        token.userId = String(user.id);
        token.sessionGeneration = pinned;
        return token;
      }
      const userId = user?.id ?? token.userId;
      if (!userId) return token;
      const row = getDb().prepare(
        "SELECT session_generation FROM users WHERE id = ? AND account_type = 'member'"
      ).get(Number(userId)) as { session_generation: number } | undefined;
      if (!row) {
        delete token.userId;
        delete token.sessionGeneration;
        return token;
      }
      const current = row.session_generation ?? 0;
      if (user?.id) {
        token.userId = String(user.id);
        token.sessionGeneration = current;
        return token;
      }
      if (!sessionGenerationMatches(token.sessionGeneration, current)) {
        delete token.userId;
        delete token.sessionGeneration;
        return token;
      }
      token.sessionGeneration = current;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.userId) {
        session.user.id = token.userId as string;
        session.user.sessionGeneration = typeof token.sessionGeneration === 'number'
          ? token.sessionGeneration
          : 0;
      }
      return session;
    },
  },
  pages: {
    signIn: '/',
  },
  session: {
    strategy: 'jwt',
  },
});
