import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ArrowRight } from "@/ui/icons";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { useSession } from "@/state/session";
import { useBrand } from "@/theme/BrandProvider";
import { Button, ErrorNote, Field, Stack, Text, useLayout } from "@/ui/primitives";

type Tenant = { id: string; name: string; slug: string; role: string };

const MESSAGES: Record<string, string> = {
  invalid: "That email and password do not match.",
  limited: "Too many attempts. Wait a few minutes and try again.",
  mfa_required: "We emailed you a sign-in code. Open the link in the email on this device to continue.",
  unavailable: "Sign-in is unavailable right now.",
};

export default function SignIn() {
  const { tokens: t, theme } = useBrand();
  const slug = useSession((s) => s.brandSlug);
  const brand = useQuery({ queryKey: ["public-brand", slug], queryFn: () => api<{ name: string }>(`/public/brand/${slug}`), enabled: !!slug, staleTime: 3_600_000, retry: false });
  const { wide, gutter } = useLayout();
  const qc = useQueryClient();
  const setSession = useSession((s) => s.set);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);

  const choose = (tenant: Tenant) => {
    setSession({ tenantId: tenant.id, storeId: null, brandSlug: tenant.slug });
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

  const brandName = brand.data?.name ?? "Point of sale";
  const logo = theme.logo.mark ?? (t.scheme === "dark" ? theme.logo.dark : theme.logo.light);
  const form = (
    <View style={{ width: "100%", maxWidth: 400, gap: t.space(5) }}>
      {tenants ? (
        <Stack gap={4}>
          <Stack gap={1}>
            <Text variant="heading" accessibilityRole="header">
              Choose a business
            </Text>
            <Text variant="label" tone="muted">
              Your account works for more than one.
            </Text>
          </Stack>
          <View style={{ gap: t.space(2) }}>
            {tenants.map((tn) => (
              <Button key={tn.id} kind="secondary" size="lg" label={tn.name} trailing={<Text variant="caption" tone="muted">{tn.role.charAt(0) + tn.role.slice(1).toLowerCase()}</Text>} onPress={() => choose(tn)} />
            ))}
          </View>
        </Stack>
      ) : (
        <Stack gap={4}>
          <Stack gap={1}>
            <Text variant="heading" accessibilityRole="header">
              Sign in
            </Text>
            <Text variant="label" tone="muted">
              Use the email your manager invited.
            </Text>
          </Stack>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
          {error ? <ErrorNote message={error} /> : null}
          <Button label="Sign in" onPress={submit} loading={busy} disabled={!email || !password} size="lg" block trailing={<ArrowRight size={18} color={t.color.onPrimary} />} />
        </Stack>
      )}
      <Text variant="caption" tone="muted">
        Sales you make offline are kept on this device and sync when the connection returns.
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: t.color.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, flexDirection: wide ? "row" : "column" }} keyboardShouldPersistTaps="handled">
        {/* The store's own colour carries the brand panel; the form stays on a calm surface. */}
        <View style={{ flex: wide ? 1 : undefined, backgroundColor: t.color.primary, padding: gutter * (wide ? 2 : 1), paddingTop: wide ? gutter * 2 : gutter * 3, justifyContent: "space-between", gap: t.space(8), minHeight: wide ? undefined : 220 }}>
          {logo ? <Image source={{ uri: logo }} style={{ width: 48, height: 48, borderRadius: t.radius.sm }} accessibilityLabel={`${brandName} logo`} /> : <View />}
          <Stack gap={2}>
            <Text variant="display" tone="onPrimary" accessibilityRole="header">
              {brandName}
            </Text>
            <Text tone="onPrimary" style={{ opacity: 0.85, maxWidth: 420 }}>
              Sell, look after your clients and run every store from one place.
            </Text>
          </Stack>
        </View>
        <View style={{ flex: wide ? 1 : undefined, alignItems: "center", justifyContent: "center", padding: gutter * (wide ? 2 : 1), paddingVertical: gutter * 2 }}>{form}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
