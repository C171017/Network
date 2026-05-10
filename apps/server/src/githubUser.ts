import type { User } from "@supabase/supabase-js";

/** Match client-side inference in apps/web/src/App.tsx */
export function readGithubLoginFromUser(user: User): string | null {
  const md = user.user_metadata as Record<string, unknown>;
  const direct = md.user_name ?? md.preferred_username ?? md.name;
  if (typeof direct === "string" && direct.length > 0) return direct.replace(/^@/, "");

  const identities = user.identities as
    | Array<{ provider?: string; identity_data?: Record<string, unknown> }>
    | undefined;
  const gh = identities?.find((i) => i.provider === "github");
  const userName = gh?.identity_data?.user_name;
  if (typeof userName === "string" && userName.length > 0) return userName.replace(/^@/, "");

  return null;
}
