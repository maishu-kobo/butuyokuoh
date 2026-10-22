import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { getDb } from '@/lib/db';
import { sessionGenerationMatches, verifyPassword, User } from '@/lib/auth';
import { linkGoogleAccount } from '@/lib/link-google-account';

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
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

        const isValid = await verifyPassword(
          credentials.password as string,
          user.password_hash
        );

        if (!isValid) {
          return null;
        }

        return {
          id: String(user.id),
          email: user.email,
          name: user.name,
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
    async jwt({ token, user }) {
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
