import { assignableRoles } from "@luxury-pos/core";
import { useState } from "react";
import { ActivityTab } from "@/features/team/ActivityTab";
import { AddMemberSheet, EditMemberSheet, IssuedDialog, type Issued } from "@/features/team/MemberSheets";
import { MembersTab } from "@/features/team/MembersTab";
import { RolesTab } from "@/features/team/RolesTab";
import { type StaffMember } from "@/features/team/queries";
import { useCan, useMe } from "@/lib/queries";
import { useTokens } from "@/theme/BrandProvider";
import { UserPlus } from "@/ui/icons";
import { Button, EmptyState, Segmented, Skeleton, Stack } from "@/ui/primitives";
import { Screen } from "@/ui/Screen";

type Tab = "members" | "roles" | "activity";
const TABS: { value: Tab; label: string }[] = [
  { value: "members", label: "Members" },
  { value: "roles", label: "Roles" },
  { value: "activity", label: "Activity" },
];
const SUBTITLE = "People, what each role may do, and who did what.";

/** Team management: people, role permissions and the audit trail. Owners and managers only. */
export default function TeamPage() {
  const me = useMe();
  const can = useCan();
  if (me.isPending)
    return (
      <Screen title="Team" subtitle={SUBTITLE}>
        <Skeleton height={200} />
      </Screen>
    );
  if (!can("staff.manage"))
    return (
      <Screen title="Team" subtitle={SUBTITLE}>
        <EmptyState title="Team is for owners and managers" body="Ask an owner or manager to change who works here or what they can do." />
      </Screen>
    );
  return <TeamWorkspace />;
}

function TeamWorkspace() {
  const t = useTokens();
  const me = useMe();
  const [tab, setTab] = useState<Tab>("members");
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);

  const stores = me.data?.stores ?? [];
  const myRole = me.data?.me.role;
  const assignable = myRole ? assignableRoles(myRole) : [];

  return (
    <Screen
      title="Team"
      subtitle={SUBTITLE}
      fill
      actions={
        tab === "members" ? <Button label="Add team member" icon={<UserPlus size={18} color={t.color.onPrimary} />} onPress={() => setAdding(true)} /> : undefined
      }
      toolbar={<Segmented label="Team sections" value={tab} onChange={setTab} options={TABS} />}
    >
      <Stack gap={0} style={{ flex: 1 }}>
        {tab === "members" ? <MembersTab stores={stores} selectedId={editing?.id ?? null} onEdit={setEditing} /> : null}
        {tab === "roles" ? <RolesTab /> : null}
        {tab === "activity" ? <ActivityTab stores={stores} /> : null}
      </Stack>

      {adding ? (
        <AddMemberSheet
          stores={stores}
          assignable={assignable}
          onClose={() => setAdding(false)}
          onAdded={(result) => {
            setAdding(false);
            setIssued(result);
          }}
        />
      ) : null}
      {editing ? <EditMemberSheet key={editing.id} member={editing} stores={stores} assignable={assignable} onClose={() => setEditing(null)} /> : null}
      {issued ? <IssuedDialog issued={issued} onClose={() => setIssued(null)} /> : null}
    </Screen>
  );
}
