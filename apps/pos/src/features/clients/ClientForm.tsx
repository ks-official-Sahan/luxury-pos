import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { Plus, Trash } from "@/ui/icons";
import { Sheet } from "@/ui/Sheet";
import { toast } from "@/ui/toast";
import { Button, ErrorNote, Field, IconButton, Row, Stack, Switch, Text } from "@/ui/primitives";
import { buildClientPayload, initialClientForm, isMasked, newPreferenceRow, validateClientForm, type ClientFormErrors, type ClientFormValues, type ClientPayload, type ClientRecord, type PreferenceRow } from "./model";

interface ClientFormProps {
  /** null creates a client; a record edits it. */
  client: ClientRecord | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}

type ErrorKey = keyof ClientFormErrors;

/** Create and edit share one form. Mounted only while open, so every open starts from the saved values. */
export function ClientForm({ client, onClose, onSaved }: ClientFormProps) {
  const t = useTokens();
  const term = useTerm();
  const qc = useQueryClient();
  const noun = term("Customer").toLowerCase();
  const editing = client !== null;
  const [values, setValues] = useState<ClientFormValues>(() => initialClientForm(client));
  const [attempted, setAttempted] = useState(false);
  const errors = validateClientForm(values);
  const invalid = Object.keys(errors).length > 0;
  const shown = (key: ErrorKey): string | null => (attempted ? (errors[key] ?? null) : null);

  const set = <K extends Exclude<keyof ClientFormValues, "preferences">>(key: K, value: ClientFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const setPref = (uid: number, patch: Partial<Pick<PreferenceRow, "key" | "value">>) =>
    setValues((v) => ({ ...v, preferences: v.preferences.map((p) => (p.uid === uid ? { ...p, ...patch } : p)) }));
  const addPref = () => setValues((v) => ({ ...v, preferences: [...v.preferences, newPreferenceRow()] }));
  const removePref = (uid: number) => setValues((v) => ({ ...v, preferences: v.preferences.filter((p) => p.uid !== uid) }));

  const save = useMutation({
    mutationFn: (body: ClientPayload) =>
      client
        ? api<{ id: string }>(`/customers/${encodeURIComponent(client.id)}`, { method: "PATCH", json: body })
        : api<{ id: string }>("/customers", { method: "POST", json: body }),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: ["client", saved.id] });
      toast.success(editing ? `${term("Customer")} saved` : `${term("Customer")} added`);
      onSaved(saved.id);
    },
  });

  const submit = () => {
    setAttempted(true);
    if (invalid || !values.firstName.trim()) return;
    save.mutate(buildClientPayload(values, client));
  };

  const prefError = shown("preferences");
  const failure = save.error instanceof Error ? save.error.message : "Try again.";

  return (
    <Sheet
      visible
      onClose={onClose}
      title={editing ? `Edit ${noun}` : `New ${noun}`}
      description={editing ? undefined : "Only the first name is required."}
      footer={<Button label={editing ? "Save changes" : `Add ${noun}`} size="lg" block loading={save.isPending} disabled={!values.firstName.trim() || save.isPending} onPress={submit} />}
    >
      <Field label="First name" value={values.firstName} onChangeText={(v) => set("firstName", v)} maxLength={80} autoComplete="given-name" error={shown("firstName")} />
      <Field label="Last name" value={values.lastName} onChangeText={(v) => set("lastName", v)} maxLength={80} autoComplete="family-name" />
      <Field
        label="Email"
        value={values.email}
        onChangeText={(v) => set("email", v)}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        maxLength={254}
        error={shown("email")}
        hint={maskedHint(client?.email, "email")}
      />
      <Field label="Phone" value={values.phone} onChangeText={(v) => set("phone", v)} keyboardType="phone-pad" maxLength={32} hint={maskedHint(client?.phone, "phone number")} />
      <Field
        label="Birthday"
        value={values.birthday}
        onChangeText={(v) => set("birthday", v)}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        error={shown("birthday")}
        hint="Optional. Format YYYY-MM-DD."
      />
      <Field label="Notes" value={values.notes} onChangeText={(v) => set("notes", v)} multiline numberOfLines={3} maxLength={2000} />
      <Switch value={values.marketingConsent} onChange={(v) => set("marketingConsent", v)} label="Marketing consent" description="The client agrees to receive offers and news." />

      <Stack gap={3}>
        <Stack gap={1}>
          <Text variant="subheading" accessibilityRole="header">
            Preferences
          </Text>
          <Text variant="caption" tone="muted">
            Name and value, for example Ring size: 52.
          </Text>
        </Stack>
        {values.preferences.map((p) => (
          <Row key={p.uid} align="flex-end" gap={2}>
            <Field label="Preference name" hideLabel value={p.key} onChangeText={(key) => setPref(p.uid, { key })} placeholder="Name" maxLength={40} style={{ flex: 1 }} />
            <Field label="Preference value" hideLabel value={p.value} onChangeText={(value) => setPref(p.uid, { value })} placeholder="Value" maxLength={200} style={{ flex: 1 }} />
            <IconButton label={p.key.trim() ? `Remove preference ${p.key.trim()}` : "Remove preference"} onPress={() => removePref(p.uid)}>
              <Trash size={18} color={t.color.text} />
            </IconButton>
          </Row>
        ))}
        {prefError ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {prefError}
          </Text>
        ) : null}
        <Button kind="ghost" size="sm" label="Add preference" icon={<Plus size={16} color={t.color.text} />} onPress={addPref} style={{ alignSelf: "flex-start" }} />
      </Stack>

      {save.error ? <ErrorNote message={`Not saved. ${failure}`} /> : null}
    </Sheet>
  );
}

function maskedHint(stored: string | null | undefined, kind: string): string | undefined {
  return isMasked(stored) ? `On file: ${stored}. Type a new ${kind} to replace it.` : undefined;
}
