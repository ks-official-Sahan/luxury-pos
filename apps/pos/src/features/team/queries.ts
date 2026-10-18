import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isPermission, isRole, type Permission, type Role } from "@luxury-pos/core";
import { api, ApiRequestError } from "@/lib/api";
import { roleOrder } from "./labels";

export type StaffMember = {
  id: string;
  userId: string;
  role: Role;
  storeIds: string[] | null;
  active: boolean;
  hasPin: boolean;
  createdAt: string;
  name: string | null;
  email: string;
};

export type NewStaff = { email: string; name: string; role: Role; storeIds: string[] | null };
export type StaffCreated = { membershipId: string; userId: string; temporaryPassword: string | null };
export type StaffPatch = { role?: Role; storeIds?: string[] | null; active?: boolean };

export type RoleRow = { role: Role; customized: boolean; editable: boolean; permissions: Permission[] };
export type RolesState = { permissions: Permission[]; roles: RoleRow[] };
export type RoleChange = { role: Role; permissions: Permission[] } | { role: Role; reset: true };

export type AuditItem = {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  data: Record<string, unknown> | null;
  createdAt: string;
  storeId: string | null;
  actor: string | null;
};
type AuditPage = { items: AuditItem[]; nextCursor: string | null };

type RawRoles = { permissions: string[]; roles: { role: string; customized: boolean; editable: boolean; permissions: string[] }[] };

/** Narrows server strings to the typed catalogue and orders roles. */
function toRolesState(raw: RawRoles): RolesState {
  const permissions = raw.permissions.filter(isPermission);
  const roles = raw.roles
    .flatMap((r): RoleRow[] => (isRole(r.role) ? [{ role: r.role, customized: r.customized, editable: r.editable, permissions: r.permissions.filter(isPermission) }] : []))
    .sort((a, b) => roleOrder(a.role, b.role));
  return { permissions, roles };
}

/** A message safe to show: API errors carry one, anything else gets the fallback. */
export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiRequestError ? e.message : fallback;
}

export function useStaff() {
  return useQuery({ queryKey: ["staff"], queryFn: ({ signal }) => api<StaffMember[]>("/staff", { signal }) });
}

export function useRoles() {
  return useQuery({ queryKey: ["roles"], queryFn: async ({ signal }) => toRolesState(await api<RawRoles>("/roles", { signal })) });
}

export function useAuditLog(action: string) {
  return useInfiniteQuery({
    queryKey: ["audit", action],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const qs = new URLSearchParams({ limit: "50" });
      if (pageParam) qs.set("cursor", pageParam);
      if (action) qs.set("action", action);
      return api<AuditPage>(`/audit?${qs.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAddStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewStaff) => api<StaffCreated>("/staff", { method: "POST", json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["staff"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useUpdateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: StaffPatch }) => api<unknown>(`/staff/${id}`, { method: "PATCH", json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["staff"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

/** Changes are applied one role at a time; the last response is the full, current matrix. */
export function useSaveRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (changes: RoleChange[]) => {
      let state: RolesState | null = null;
      for (const c of changes) {
        const json = "reset" in c ? { reset: true } : { permissions: c.permissions };
        state = toRolesState(await api<RawRoles>(`/roles/${c.role}`, { method: "PUT", json }));
      }
      return state;
    },
    onSuccess: (state) => {
      if (state) qc.setQueryData<RolesState>(["roles"], state);
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["roles"] });
    },
  });
}
