import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ArrowRight } from "@/ui/icons";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { useSession } from "@/state/session";
import { useBrand } from "@/theme/BrandProvider";
import { Button, Chip, Eyebrow, Field, Stack, Surface, Text, useLayout } from "@/ui/primitives";

type Tenant = { id: string; name: string; slug: string; role: string };

const MESSAGES: Record<string, string> = {
  invalid: "That email and password do not match.",
  limited: "Too many attempts. Wait a few minutes and try again.",
  mfa_required: "We emailed you a sign-in code. Open the link in the email on this device to continue.",
  unavailable: "Sign-in is unavailable right now.",
};

export default function SignIn() {
  const { tokens: t, theme } = useBrand();
  const { wide, gutter } = useLayout();
  const qc = useQueryClient();
  const setSession = useSession((s) => s.set);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);

  const choose = (tenant: Tenant) => {
    setSession({ tenantId: tenant.id, storeId: null });
    void qc.invalidateQueries();
    router.replace("/");
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.authKit.signIn({ email: email.trim(), password });
      if (!result.ok) return setError(MESSAGES[result.code] ?? MESSAGES.unavailable!);
      const list = await api<Tenant[]>("/tenants");
      if (list.length === 1) return choose(list[0]!);
      if (!list.length) return setError("Your account is not linked to a business yet. Ask your manager for an invitation.");
      setTenants(list);
    } catch {
      setError("Could not reach the server. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: t.color.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, flexDirection: wide ? "row" : "column", padding: gutter, gap: gutter * 2, alignItems: wide ? "center" : "stretch", justifyContent: "center" }} keyboardShouldPersistTaps="handled">
        <Stack gap={4} style={{ flex: wide ? 1 : undefined, maxWidth: 560, paddingTop: wide ? 0 : t.space(12) }}>
          <Eyebrow>Point of sale</Eyebrow>
          <Text variant="display" accessibilityRole="header">
            {theme.name}
          </Text>
          <Text tone="muted" style={{ maxWidth: 420 }}>
            Sell, look after your clients and run every boutique from one place — online or off.
          </Text>
        </Stack>

        <Surface style={{ width: "100%", maxWidth: 440 }} raised>
          {tenants ? (
            <Stack gap={4}>
              <Text variant="heading">Choose a business</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space(2) }}>
                {tenants.map((tn) => (
                  <Chip key={tn.id} label={`${tn.name} · ${tn.role.toLowerCase()}`} onPress={() => choose(tn)} />
                ))}
              </View>
            </Stack>
          ) : (
            <Stack gap={4}>
              <Text variant="heading">Sign in</Text>
              <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
              <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
              {error ? <Text tone="danger" variant="label">{error}</Text> : null}
              <Button label="Continue" onPress={submit} loading={busy} disabled={!email || !password} size="lg" trailing={<ArrowRight size={18} weight="light" color={t.color.onPrimary} />} />
            </Stack>
          )}
        </Surface>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
