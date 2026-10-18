import { useMemo } from "react";
import { View } from "react-native";
import type { StoreInfo } from "@/lib/queries";
import { useTokens } from "@/theme/BrandProvider";
import { DataList, type Column } from "@/ui/DataList";
import { Avatar, Badge, EmptyState, ErrorNote, Panel, Row, Text, useLayout } from "@/ui/primitives";
import { roleTitle, storesLabel } from "./labels";
import { useStaff, type StaffMember } from "./queries";

export function MembersTab({ stores, selectedId, onEdit }: { stores: readonly StoreInfo[]; selectedId: string | null; onEdit: (m: StaffMember) => void }) {
  const t = useTokens();
  const { bp, gutter } = useLayout();
  const staff = useStaff();
  const names = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);

  const columns = useMemo<Column<StaffMember>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        flex: 3,
        render: (m) => (
          <Row gap={3} style={{ minWidth: 0 }}>
            <Avatar name={m.name ?? m.email} size={32} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" numberOfLines={1} style={{ fontWeight: "600" }}>
                {m.name ?? m.email}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {m.email}
              </Text>
            </View>
          </Row>
        ),
      },
      { key: "role", header: "Role", flex: 1.2, phone: true, render: (m) => <Badge tone="primary" label={roleTitle(m.role)} /> },
      {
        key: "stores",
        header: "Stores",
        flex: 2,
        phone: true,
        render: (m) => (
          <Text variant="label" tone="muted" numberOfLines={1}>
            {storesLabel(m.storeIds, names)}
          </Text>
        ),
      },
      { key: "pin", header: "PIN", flex: 1, phone: true, render: (m) => <Badge tone={m.hasPin ? "success" : "neutral"} label={m.hasPin ? "Set" : "Not set"} /> },
      { key: "status", header: "Status", flex: 1, align: "right", render: (m) => <Badge tone={m.active ? "success" : "neutral"} label={m.active ? "Active" : "Inactive"} /> },
    ],
    [names],
  );

  return (
    <View style={{ flex: 1, paddingHorizontal: bp === "phone" ? gutter : 0, paddingBottom: bp === "phone" ? gutter : 0 }}>
      <Panel padded={false} style={{ flex: 1, minHeight: 0 }}>
        <DataList
          label="Team members"
          rows={staff.data}
          columns={columns}
          keyOf={(m) => m.id}
          selectedKey={selectedId}
          onPress={onEdit}
          loading={staff.isPending}
          empty={
            staff.error ? (
              <View style={{ padding: t.space(4) }}>
                <ErrorNote message="The team could not load." onRetry={() => void staff.refetch()} />
              </View>
            ) : (
              <EmptyState title="No team members yet" body="Add the people who work at your stores. They sign in with the email you give them." />
            )
          }
        />
      </Panel>
    </View>
  );
}
