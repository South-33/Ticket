import { ConvexError } from "convex/values";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";

type AuthCtx = QueryCtx | MutationCtx | ActionCtx;

export async function getAuthUserIdOrThrow(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.tokenIdentifier) {
    throw new ConvexError("Not authenticated");
  }
  return identity.tokenIdentifier;
}
