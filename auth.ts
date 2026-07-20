import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { isAllowedExternalGoogleEmail } from "@/lib/partner-access";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  providers: [Google],
  callbacks: {
    async signIn({ user, profile }) {
      return isAllowedExternalGoogleEmail(
        user.email ?? (typeof profile?.email === "string" ? profile.email : null),
        profile?.email_verified === true,
      );
    },
    session({ session, token }) {
      if (session.user) {
        const user = session.user as typeof session.user & { id?: string };
        user.id = `google:${token.sub ?? token.email ?? session.user.email}`;
      }
      return session;
    },
  },
});
