import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { getDb } from '@/lib/db';
import { verifyPassword, User } from '@/lib/auth';

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
          .prepare('SELECT * FROM users WHERE email = ?')
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
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        const db = getDb();
        const email = user.email!;
        const googleId = account.providerAccountId;
        const name = user.name || null;

        // 既存ユーザーをチェック
        const existingUser = db
          .prepare('SELECT * FROM users WHERE email = ? OR google_id = ?')
          .get(email, googleId) as (User & { google_id: string | null }) | undefined;

        if (existingUser) {
          // google_idを更新（メールで登録済みだがgoogle_idがない場合）
          if (!existingUser.google_id) {
            db.prepare('UPDATE users SET google_id = ?, name = COALESCE(name, ?) WHERE id = ?').run(
              googleId,
              name,
              existingUser.id
            );
          }
          // セッション用にユーザーIDをセット
          user.id = String(existingUser.id);
        } else {
          // 新規ユーザー作成
          const result = db
            .prepare('INSERT INTO users (email, password_hash, google_id, name) VALUES (?, NULL, ?, ?)')
            .run(email, googleId, name);
          user.id = String(result.lastInsertRowid);
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.userId) {
        session.user.id = token.userId as string;
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
