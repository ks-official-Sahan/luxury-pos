import type { Permission } from "@luxury-pos/core";
import { Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { Check } from "@/ui/icons";
import { Badge, Button, focusRing, Panel, Text } from "@/ui/primitives";
import { labelFor, roleTitle, type PermissionGroup } from "./labels";
import type { RoleRow } from "./queries";

/** A role column as the screens see it: server row plus staged edits. */
export type RowView = { row: RoleRow; perms: ReadonlySet<Permission>; dirty: boolean; resetStaged: boolean };
export type Edit = { permissions: Set<Permission>; reset: boolean };

export const LABEL_W = 280;
export const CELL_W = 104;
export const HEADER_H = 64;
export const GROUP_H = 36;
export const ROW_H = 48;
export const FOOTER_H = 56;

/** A permission can be turned off always, and turned on only when the actor holds it. */
export function canToggle(v: RowView, p: Permission, held: ReadonlySet<Permission>): boolean {
  return v.perms.has(p) || held.has(p);
}

export function PermissionBox({
  label,
  roleName,
  checked,
  editable,
  allowed,
  changed,
  onToggle,
}: {
  label: string;
  roleName: string;
  checked: boolean;
  editable: boolean;
  allowed: boolean;
  changed: boolean;
  onToggle: () => void;
}) {
  const t = useTokens();
  if (!editable)
    return (
      <View accessible accessibilityRole="checkbox" accessibilityState={{ checked, disabled: true }} accessibilityLabel={`${label}, ${roleName}, read only`} style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
        {checked ? <Check size={16} color={t.color.textMuted} /> : null}
      </View>
    );
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`${label} for ${roleName}`}
      accessibilityState={{ checked, disabled: !allowed }}
      accessibilityHint={changed ? "Changed, not saved yet" : allowed ? undefined : "You do not hold this permission, so you cannot grant it"}
      disabled={!allowed}
      onPress={onToggle}
      hitSlop={8}
      style={({ hovered, focused }: { hovered?: boolean; focused?: boolean }) =>
        ({
          width: 24,
          height: 24,
          borderRadius: t.radius.sm,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: changed ? 2 : 1.5,
          borderColor: checked || changed ? t.color.primary : t.color.borderStrong,
          backgroundColor: checked ? t.color.primary : hovered && allowed ? t.color.hover : t.color.surface,
          opacity: allowed ? 1 : 0.45,
          ...focusRing(t, focused),
        }) as ViewStyle
      }
    >
      {checked ? <Check size={16} color={t.color.onPrimary} weight="bold" /> : null}
    </Pressable>
  );
}

/** Desktop: permissions down, roles across. The label column stays put while the role columns scroll. */
export function RolesMatrix({
  groups,
  views,
  held,
  onToggle,
  onReset,
}: {
  groups: PermissionGroup[];
  views: RowView[];
  held: ReadonlySet<Permission>;
  onToggle: (row: RoleRow, p: Permission) => void;
  onReset: (row: RoleRow) => void;
}) {
  const t = useTokens();
  const term = useTerm();
  return (
    <Panel padded={false}>
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: LABEL_W, backgroundColor: t.color.surface, borderRightWidth: 1, borderRightColor: t.color.border }}>
          <View style={{ height: HEADER_H, justifyContent: "flex-end", paddingHorizontal: t.space(4), paddingBottom: t.space(2) }}>
            <Text variant="caption" tone="muted" style={{ fontWeight: "600" }}>
              Permission
            </Text>
          </View>
          {groups.map((g) => (
            <View key={g.key}>
              <View style={{ height: GROUP_H, justifyContent: "flex-end", paddingHorizontal: t.space(4), paddingBottom: 6, backgroundColor: t.color.surfaceSunken }}>
                <Text variant="caption" tone="muted" style={{ fontWeight: "600" }} accessibilityRole="header">
                  {g.title}
                </Text>
              </View>
              {g.items.map((p) => (
                <View key={p} style={{ height: ROW_H, justifyContent: "center", paddingHorizontal: t.space(4), borderTopWidth: 1, borderTopColor: t.color.border }}>
                  <Text variant="label" numberOfLines={2}>
                    {labelFor(p, term)}
                  </Text>
                </View>
              ))}
            </View>
          ))}
          <View style={{ height: FOOTER_H, justifyContent: "center", paddingHorizontal: t.space(4), borderTopWidth: 1, borderTopColor: t.color.border }}>
            <Text variant="caption" tone="muted">
              Reset a role to its defaults
            </Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={{ flexDirection: "row", height: HEADER_H }}>
              {views.map((v) => (
                <View key={v.row.role} style={{ width: CELL_W, justifyContent: "flex-end", alignItems: "center", paddingBottom: t.space(2), gap: 4 }}>
                  <Text variant="label" style={{ fontWeight: "600" }} numberOfLines={1}>
                    {roleTitle(v.row.role)}
                  </Text>
                  <View style={{ height: 22, justifyContent: "center" }}>{v.row.customized ? <Badge tone="primary" label="Customized" /> : null}</View>
                </View>
              ))}
            </View>

            {groups.map((g) => (
              <View key={g.key}>
                <View style={{ height: GROUP_H, backgroundColor: t.color.surfaceSunken }} />
                {g.items.map((p) => (
                  <View key={p} style={{ flexDirection: "row", height: ROW_H, alignItems: "center", borderTopWidth: 1, borderTopColor: t.color.border }}>
                    {views.map((v) => (
                      <View key={v.row.role} style={{ width: CELL_W, alignItems: "center" }}>
                        <PermissionBox
                          label={labelFor(p, term)}
                          roleName={roleTitle(v.row.role)}
                          checked={v.perms.has(p)}
                          editable={v.row.editable}
                          allowed={canToggle(v, p, held)}
                          changed={v.perms.has(p) !== v.row.permissions.includes(p)}
                          onToggle={() => onToggle(v.row, p)}
                        />
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ))}

            <View style={{ flexDirection: "row", height: FOOTER_H, alignItems: "center", borderTopWidth: 1, borderTopColor: t.color.border }}>
              {views.map((v) => (
                <View key={v.row.role} style={{ width: CELL_W, alignItems: "center" }}>
                  <Button
                    kind="ghost"
                    size="sm"
                    label={v.resetStaged ? "Undo" : "Reset"}
                    accessibilityHint={`${v.resetStaged ? "Cancel the staged reset of" : "Restore default permissions for"} ${roleTitle(v.row.role)}`}
                    disabled={!v.row.editable || (!v.row.customized && !v.resetStaged)}
                    onPress={() => onReset(v.row)}
                  />
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    </Panel>
  );
}

