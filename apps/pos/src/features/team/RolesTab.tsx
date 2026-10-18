import { DEFAULT_MATRIX, type Permission, type Role } from "@luxury-pos/core";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useMe } from "@/lib/queries";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { Check } from "@/ui/icons";
import { toast } from "@/ui/toast";
import { Badge, Button, ErrorNote, Panel, Row, Skeleton, Stack, Switch, Text, Chip, useLayout } from "@/ui/primitives";
import { groupPermissions, labelFor, roleTitle, sameMembers, type PermissionGroup } from "./labels";
import { canToggle, RolesMatrix, type Edit, type RowView } from "./RolesMatrix";
import { errorMessage, useRoles, useSaveRoles, type RoleChange, type RoleRow } from "./queries";

/** Phone and tablet: one role at a time as a grouped Switch list. */
function RoleSwitches({ view, groups, held, onToggle }: { view: RowView; groups: PermissionGroup[]; held: ReadonlySet<Permission>; onToggle: (p: Permission) => void }) {
  const t = useTokens();
  const term = useTerm();
  const editable = view.row.editable;
  const roleName = roleTitle(view.row.role);
  return (
    <Stack gap={5}>
      {groups.map((g) => (
        <Stack key={g.key} gap={2}>
          <Text variant="label" tone="muted" accessibilityRole="header" style={{ fontWeight: "600" }}>
            {g.title}
          </Text>
          <Panel padded={false}>
            {g.items.map((p, i) => {
              const label = labelFor(p, term);
              const checked = view.perms.has(p);
              const allowed = canToggle(view, p, held);
              const border = i > 0 ? { borderTopWidth: 1, borderTopColor: t.color.border } : null;
              if (!editable)
                return (
                  <View key={p} accessible accessibilityLabel={`${label}: ${checked ? "included" : "not included"}`} style={[{ flexDirection: "row", alignItems: "center", gap: t.space(3), minHeight: t.hit, paddingHorizontal: t.space(4) }, border]}>
                    <Text variant="label" style={{ flex: 1 }}>
                      {label}
                    </Text>
                    {checked ? <Check size={18} color={t.color.textMuted} /> : <Text variant="caption" tone="muted">Not included</Text>}
                  </View>
                );
              return (
                <View key={p} style={[{ paddingHorizontal: t.space(4), opacity: allowed ? 1 : 0.5 }, border]}>
                  <Switch label={`${label} for ${roleName}`} value={checked} onChange={() => allowed && onToggle(p)} description={allowed ? undefined : "Not in your role, so you cannot grant it."} />
                </View>
              );
            })}
          </Panel>
        </Stack>
      ))}
    </Stack>
  );
}

type Edits = Partial<Record<Role, Edit>>;

/**
 * Roles: the matrix on desktop, a role picker plus switches on smaller screens.
 * Changes are staged locally; one bar saves them all (PUT per changed role).
 */
export function RolesTab() {
  const t = useTokens();
  const term = useTerm();
  const { bp, gutter } = useLayout();
  const roles = useRoles();
  const save = useSaveRoles();
  const me = useMe();
  const held = useMemo<ReadonlySet<Permission>>(() => new Set(me.data?.permissions ?? []), [me.data]);
  const [edits, setEdits] = useState<Edits>({});
  const [chosen, setChosen] = useState<Role>("ASSOCIATE");

  const state = roles.data;
  const groups = groupPermissions(state?.permissions ?? [], term);
  const views = useMemo<RowView[]>(
    () =>
      (state?.roles ?? []).map((row) => {
        const e = edits[row.role];
        const server = new Set(row.permissions);
        const perms: ReadonlySet<Permission> = e?.permissions ?? server;
        const dirty = e ? (e.reset ? row.customized : !sameMembers(perms, server)) : false;
        return { row, perms, dirty, resetStaged: e?.reset ?? false };
      }),
    [state, edits],
  );
  const dirtyCount = views.filter((v) => v.dirty).length;
  const active = views.find((v) => v.row.role === chosen) ?? views[0];

  const toggle = (row: RoleRow, p: Permission) =>
    setEdits((prev) => {
      const next = new Set<Permission>(prev[row.role]?.permissions ?? row.permissions);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return { ...prev, [row.role]: { permissions: next, reset: false } };
    });

  /** Stages the defaults; pressing again cancels the staged reset. */
  const resetRole = (row: RoleRow) =>
    setEdits((prev) => {
      const next: Edits = { ...prev };
      if (prev[row.role]?.reset) delete next[row.role];
      else next[row.role] = { permissions: new Set(DEFAULT_MATRIX[row.role]), reset: true };
      return next;
    });

  const submit = () => {
    const changes: RoleChange[] = views
      .filter((v) => v.dirty)
      .map((v) => (v.resetStaged ? { role: v.row.role, reset: true as const } : { role: v.row.role, permissions: [...v.perms] }));
    if (!changes.length) return;
    save.mutate(changes, {
      onSuccess: () => {
        setEdits({});
        toast.success(changes.length === 1 ? `${roleTitle(changes[0]!.role)} saved` : "Role changes saved");
      },
      onError: (e) => toast.error(errorMessage(e, "Could not save the roles. Your changes are still here.")),
    });
  };

  if (!state || !active) {
    return roles.error ? (
      <View style={{ padding: gutter }}>
        <ErrorNote message="The roles could not load." onRetry={() => void roles.refetch()} />
      </View>
    ) : (
      <Stack gap={4} style={{ padding: gutter }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} height={18} />
        ))}
      </Stack>
    );
  }

  const px = bp === "phone" ? gutter : 0;
  const explain = (
    <Text variant="label" tone="muted">
      Changes apply to everyone with that role within a minute. You can only grant permissions you hold.
    </Text>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: px, paddingTop: t.space(2), paddingBottom: t.space(6), gap: t.space(5) }}>
        {explain}
        {bp === "desktop" ? (
          <RolesMatrix groups={groups} views={views} held={held} onToggle={toggle} onReset={resetRole} />
        ) : (
          <Stack gap={5}>
            <Row gap={2} wrap>
              {views.map((v) => (
                <Chip key={v.row.role} label={roleTitle(v.row.role)} selected={active.row.role === v.row.role} onPress={() => setChosen(v.row.role)} />
              ))}
            </Row>
            <Row justify="space-between" wrap>
              <Row gap={2}>
                <Text variant="heading" accessibilityRole="header">
                  {roleTitle(active.row.role)}
                </Text>
                {active.row.customized ? <Badge tone="primary" label="Customized" /> : null}
              </Row>
              {active.row.editable ? (
                <Button kind="ghost" size="sm" label={active.resetStaged ? "Undo reset" : "Reset to default"} disabled={!active.row.customized && !active.resetStaged} onPress={() => resetRole(active.row)} />
              ) : null}
            </Row>
            {!active.row.editable ? (
              <Text variant="caption" tone="muted">
                This role's permissions are fixed.
              </Text>
            ) : null}
            <RoleSwitches view={active} groups={groups} held={held} onToggle={(p) => toggle(active.row, p)} />
          </Stack>
        )}
      </ScrollView>

      {dirtyCount > 0 ? (
        <Row gap={2} wrap style={{ padding: t.space(3), paddingHorizontal: t.space(4) + px, borderTopWidth: 1, borderTopColor: t.color.border, backgroundColor: t.color.surface }}>
          <Text variant="label" tone="muted" style={{ flex: 1 }}>
            {`${dirtyCount} unsaved ${dirtyCount === 1 ? "change" : "changes"}`}
          </Text>
          <Button kind="ghost" label="Discard" disabled={save.isPending} onPress={() => setEdits({})} />
          <Button label="Save changes" loading={save.isPending} onPress={submit} />
        </Row>
      ) : null}
    </View>
  );
}

