import type { User } from "@/lib/api";

export function isNetworkScope(user: User | null | undefined): boolean {
  return user?.role === "NETWORK_ADMIN" || user?.role === "NETWORK_LEADER";
}
