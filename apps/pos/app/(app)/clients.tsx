import { useDeferredValue, useEffect, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCan, useStore } from "@/lib/queries";
import { ClientForm } from "@/features/clients/ClientForm";
import { ClientProfileView } from "@/features/clients/ClientProfile";
import { clientName, formatDay, MIN_CLIENT_QUERY, tierLabel, type ClientRecord, type ClientSummary } from "@/features/clients/model";
import { useClientProfile, useClientSearch } from "@/features/clients/queries";
import { useCart } from "@/state/cart";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { DataList, type Column } from "@/ui/DataList";
import { MagnifyingGlass, UserPlus, X } from "@/ui/icons";
import { Screen } from "@/ui/Screen";
import { Sheet } from "@/ui/Sheet";
import { Avatar, Button, EmptyState, ErrorNote, Field, IconButton, Panel, Row, Skeleton, Stack, Text, useLayout } from "@/ui/primitives";

/**
 * Clienteling: find a client, then see history, preferences and notes beside the list.
 * Wide screens keep the profile in a pane; phones open it in a sheet. `?id=` opens a client directly.
 */
export default function Clients() {
  const t = useTokens();
  const term = useTerm();
  const can = useCan();
  const router = useRouter();
  const store = useStore();
  const { wide, gutter } = useLayout();
  const params = useLocalSearchParams<{ id?: string }>();
  const routeId = typeof params.id === "string" && params.id ? params.id : null;

  const noun = term("Customer").toLowerCase();
  const plural = `${term("Customer")}s`;
  const currency = store?.currency ?? "EUR";
  const locale = store?.locale ?? "en";
  const canWrite = can("customer.write");
  const canSell = can("sale.create");

  const [query, setQuery] = useState("");
  const needle = useDeferredValue(query.trim());
  // Empty search lists recently served clients; one character waits for the second.
  const searchable = needle.length === 0 || needle.length >= MIN_CLIENT_QUERY;
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ client: ClientRecord | null } | null>(null);

  useEffect(() => {
    if (routeId) setSelected(routeId);
  }, [routeId]);

  const search = useClientSearch(needle);
  const profile = useClientProfile(selected);
  // Wide screens open the first client rather than leaving half the screen empty.
  useEffect(() => {
    if (wide && !selected && search.data?.[0]) setSelected(search.data[0].id);
  }, [wide, selected, search.data]);

  const startSale = (c: ClientRecord) => {
    useCart.getState().setClient({ id: c.id, name: clientName(c), tierId: c.tierId, pointsBalance: c.pointsBalance });
    setSelected(null);
    router.navigate("/");
  };

  const columns: Column<ClientSummary>[] = [
    {
      key: "name",
      header: "Name",
      flex: 3,
      render: (c) => (
        <Row gap={3}>
          <Avatar name={clientName(c)} size={32} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="label" numberOfLines={1} style={{ fontWeight: "600" }}>
              {clientName(c)}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {tierLabel(c.tierId)}
            </Text>
          </View>
        </Row>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      flex: 2.5,
      phone: true,
      render: (c) => (
        <Text variant="label" tone="muted" numberOfLines={1}>
          {c.email ?? c.phone ?? "No contact on file"}
        </Text>
      ),
    },
    {
      key: "points",
      header: "Points",
      flex: 1,
      align: "right",
      render: (c) => <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>{c.pointsBalance.toLocaleString()}</Text>,
    },
    {
      key: "last",
      header: "Last purchase",
      flex: 1.3,
      align: "right",
      phone: false,
      render: (c) => (
        <Text variant="label" tone="muted">
          {formatDay(c.lastPurchaseAt, locale) ?? "None yet"}
        </Text>
      ),
    },
  ];

  const listEmpty = !searchable || !needle ? (
    <EmptyState title={`Find a ${noun}`} body={`Search by name, email or phone. ${plural} you serve appear here with their history and preferences.`} />
  ) : search.isError ? (
    <EmptyState title="Search is unavailable" body="Try again in a moment." />
  ) : (
    <EmptyState
      title="No match"
      body={`No ${noun} matches "${needle}". Check the spelling, or search by email or phone.`}
      action={canWrite ? <Button kind="secondary" label={`New ${noun}`} onPress={() => setEditor({ client: null })} /> : undefined}
    />
  );

  const listPane = (
    <View style={{ flex: 1 }}>
      {search.isError && searchable ? (
        <View style={{ padding: t.space(4) }}>
          <ErrorNote message="Clients could not load. Check the connection and try again." onRetry={() => void search.refetch()} />
        </View>
      ) : null}
      <DataList
        label={plural}
        rows={searchable ? search.data : undefined}
        keyOf={(c) => c.id}
        columns={columns}
        onPress={(c) => setSelected(c.id)}
        selectedKey={selected}
        loading={searchable && search.isPending}
        empty={listEmpty}
      />
    </View>
  );

  const data = profile.data;
  const profileNode: ReactNode = !selected ? (
    <EmptyState title={`Choose a ${noun}`} body={`Select a ${noun} to see their history, preferences and notes.`} />
  ) : profile.isError ? (
    <ErrorNote message={`This ${noun} could not be opened. Check the link or search again.`} onRetry={() => void profile.refetch()} />
  ) : data ? (
    <ClientProfileView
      profile={data}
      currency={currency}
      locale={locale}
      canSell={canSell}
      canWrite={canWrite}
      onEdit={() => setEditor({ client: data.customer })}
      onStartSale={() => startSale(data.customer)}
    />
  ) : (
    <Stack gap={4}>
      <Row gap={4}>
        <Skeleton width={64} height={64} radius={32} />
        <Stack gap={2} style={{ flex: 1 }}>
          <Skeleton width="70%" height={22} />
          <Skeleton width="40%" height={14} />
        </Stack>
      </Row>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={18} />
      ))}
    </Stack>
  );

  const toolbar = (
    <Field
      label="Name, email or phone"
      hideLabel
      value={query}
      onChangeText={setQuery}
      placeholder="Name, email or phone"
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      style={{ width: wide ? 420 : "100%" }}
      leading={<MagnifyingGlass size={18} color={t.color.textMuted} />}
      trailing={
        query ? (
          <IconButton label="Clear search" size="sm" onPress={() => setQuery("")}>
            <X size={18} color={t.color.text} />
          </IconButton>
        ) : undefined
      }
    />
  );

  return (
    <Screen
      title={plural}
      fill
      toolbar={toolbar}
      actions={
        canWrite ? <Button label={`New ${noun}`} icon={<UserPlus size={18} color={t.color.onPrimary} />} onPress={() => setEditor({ client: null })} /> : undefined
      }
    >
      {wide ? (
        <View style={{ flex: 1, flexDirection: "row", gap: t.space(5) }}>
          <Panel padded={false} style={{ flex: 1, minWidth: 0 }}>
            {listPane}
          </Panel>
          <Panel padded={false} style={{ width: 440 }}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: t.space(5) }}>
              {profileNode}
            </ScrollView>
          </Panel>
        </View>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: gutter, paddingBottom: gutter }}>
          <Panel padded={false} style={{ flex: 1 }}>
            {listPane}
          </Panel>
        </View>
      )}

      {!wide ? (
        <Sheet visible={selected !== null && editor === null} onClose={() => setSelected(null)} title={term("Customer")}>
          {profileNode}
        </Sheet>
      ) : null}

      {editor ? <ClientForm client={editor.client} onClose={() => setEditor(null)} onSaved={(id) => { setSelected(id); setEditor(null); }} /> : null}
    </Screen>
  );
}
