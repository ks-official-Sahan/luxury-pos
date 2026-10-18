import type { Role } from "@luxury-pos/core";
import { useState } from "react";
import { copyText } from "@/lib/clipboard";
import type { StoreInfo } from "@/lib/queries";
import { useTokens } from "@/theme/BrandProvider";
import { Copy } from "@/ui/icons";
import { Sheet } from "@/ui/Sheet";
import { Button, Chip, ErrorNote, Field, Panel, Row, Stack, Switch, Text } from "@/ui/primitives";
import { toast } from "@/ui/toast";
import { roleTitle, sameScope } from "./labels";
import { errorMessage, useAddStaff, useUpdateStaff, type StaffMember, type StaffPatch } from "./queries";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Issued = { name: string; email: string; password: string | null };

/** Role chips limited to the roles the actor may assign. */
export function RolePicker({ roles, value, onChange, error }: { roles: readonly Role[]; value: Role | null; onChange: (r: Role) => void; error?: string | null }) {
  return (
    <Stack gap={2}>
      <Text variant="label" tone="muted">
        Role
      </Text>
      <Row gap={2} wrap>
        {roles.map((r) => (
          <Chip key={r} label={roleTitle(r)} selected={value === r} onPress={() => onChange(r)} />
        ))}
      </Row>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Stack>
  );
}

/** "All stores" or a chosen set. Choosing none is not allowed (the caller validates). */
export function StoreScope({ stores, value, onChange }: { stores: readonly StoreInfo[]; value: string[] | null; onChange: (v: string[] | null) => void }) {
  return (
    <Stack gap={3}>
      <Switch label="All stores" value={value === null} onChange={(on) => onChange(on ? null : [])} description={value === null ? "Works at every store in the business." : "Works only at the stores chosen below."} />
      {value !== null ? (
        <Stack gap={2}>
          <Row gap={2} wrap>
            {stores.map((s) => {
              const on = value.includes(s.id);
              return <Chip key={s.id} label={s.name} selected={on} onPress={() => onChange(on ? value.filter((id) => id !== s.id) : [...value, s.id])} />;
            })}
          </Row>
          {value.length === 0 ? (
            <Text variant="caption" tone="danger" accessibilityRole="alert">
              Pick at least one store.
            </Text>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}

export function EditMemberSheet({ member, stores, assignable, onClose }: { member: StaffMember; stores: readonly StoreInfo[]; assignable: readonly Role[]; onClose: () => void }) {
  const save = useUpdateStaff();
  const canChangeRole = assignable.includes(member.role);
  const [role, setRole] = useState<Role>(member.role);
  const [storeIds, setStoreIds] = useState<string[] | null>(member.storeIds);
  const [active, setActive] = useState(member.active);
  const [error, setError] = useState<string | null>(null);

  const storesValid = storeIds === null || storeIds.length > 0;
  const patch: StaffPatch = {};
  if (canChangeRole && role !== member.role) patch.role = role;
  if (stores.length > 1 && !sameScope(storeIds, member.storeIds)) patch.storeIds = storeIds;
  if (active !== member.active) patch.active = active;
  const dirty = Object.keys(patch).length > 0;

  const submit = () => {
    if (!dirty || !storesValid) return;
    setError(null);
    save.mutate(
      { id: member.id, body: patch },
      {
        onSuccess: () => {
          toast.success("Team member saved");
          onClose();
        },
        onError: (e) => setError(errorMessage(e, "Could not save. Try again.")),
      },
    );
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={member.name ?? member.email}
      description={member.email}
      footer={<Button label="Save changes" block disabled={!dirty || !storesValid} loading={save.isPending} onPress={submit} />}
    >
      <Stack gap={5}>
        {canChangeRole ? (
          <RolePicker roles={assignable} value={role} onChange={setRole} />
        ) : (
          <Stack gap={1}>
            <Text variant="label" tone="muted">
              Role
            </Text>
            <Text variant="label" style={{ fontWeight: "600" }}>
              {roleTitle(member.role)}
            </Text>
            <Text variant="caption" tone="muted">
              Only an owner can change this person.
            </Text>
          </Stack>
        )}
        {stores.length > 1 ? <StoreScope stores={stores} value={storeIds} onChange={setStoreIds} /> : null}
        <Switch label="Active" value={active} onChange={setActive} description={active ? "Can sign in and work at their stores." : "They can no longer sign in to this business until you turn this back on."} />
        {error ? <ErrorNote message={error} /> : null}
      </Stack>
    </Sheet>
  );
}

export function AddMemberSheet({ stores, assignable, onClose, onAdded }: { stores: readonly StoreInfo[]; assignable: readonly Role[]; onClose: () => void; onAdded: (issued: Issued) => void }) {
  const add = useAddStaff();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role | null>(assignable.includes("ASSOCIATE") ? "ASSOCIATE" : (assignable[0] ?? null));
  const [storeIds, setStoreIds] = useState<string[] | null>(null);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = {
    name: name.trim() ? null : "Enter their name.",
    email: EMAIL.test(email.trim()) ? null : "Enter a valid email address.",
    role: role ? null : "Choose a role.",
    stores: storeIds === null || storeIds.length > 0 ? null : "Pick at least one store.",
  };
  const valid = !errors.name && !errors.email && !errors.role && !errors.stores;

  const submit = () => {
    setTried(true);
    if (!valid || !role) return;
    const payload = { name: name.trim(), email: email.trim().toLowerCase(), role, storeIds };
    setError(null);
    add.mutate(payload, {
      onSuccess: (res) => onAdded({ name: payload.name, email: payload.email, password: res.temporaryPassword }),
      onError: (e) => setError(errorMessage(e, "Could not add them. Try again.")),
    });
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Add team member"
      description="They sign in with this email. You will get a temporary password to share once."
      footer={<Button label="Add team member" block disabled={!assignable.length} loading={add.isPending} onPress={submit} />}
    >
      <Stack gap={5}>
        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" error={tried ? errors.name : null} />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={tried ? errors.email : null} />
        {assignable.length ? (
          <RolePicker roles={assignable} value={role} onChange={setRole} error={tried ? errors.role : null} />
        ) : (
          <Text variant="label" tone="muted">
            Your role cannot add anyone yet. Ask an owner.
          </Text>
        )}
        {stores.length > 1 ? <StoreScope stores={stores} value={storeIds} onChange={setStoreIds} /> : null}
        {error ? <ErrorNote message={error} /> : null}
      </Stack>
    </Sheet>
  );
}

/** Shown once after adding someone. The password is kept only in memory and never shown again. */
export function IssuedDialog({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const t = useTokens();
  const { name, email, password } = issued;
  const copy = () => {
    if (password) copyText(password, "Password copied").catch(() => toast.error("Could not copy. Select the password and copy it."));
  };
  return (
    <Sheet
      visible
      variant="dialog"
      onClose={onClose}
      title={password ? "Temporary password" : "Added to the team"}
      description={password ? `Share it with ${name} once. It will not be shown again.` : undefined}
      footer={
        password ? (
          <Row gap={2}>
            <Button kind="secondary" label="Copy password" icon={<Copy size={18} color={t.color.text} />} onPress={copy} style={{ flex: 1 }} />
            <Button label="Done" onPress={onClose} style={{ flex: 1 }} />
          </Row>
        ) : (
          <Button label="Done" block onPress={onClose} />
        )
      }
    >
      {password ? (
        <Stack gap={4}>
          <Text variant="label">{`${name} signs in with this password. They must choose a new one at first sign-in.`}</Text>
          <Panel tone="sunken">
            <Text variant="heading" selectable style={{ fontVariant: ["tabular-nums"] }} accessibilityLabel={`Temporary password for ${email}`}>
              {password}
            </Text>
          </Panel>
        </Stack>
      ) : (
        <Text variant="label" tone="muted">
          {`${email} already has an account. They sign in as usual with their existing password.`}
        </Text>
      )}
    </Sheet>
  );
}

