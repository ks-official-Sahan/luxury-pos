import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useCan, useMe, useStore, type StoreInfo } from "@/lib/queries";
import { AdjustSheet } from "@/features/stock/AdjustSheet";
import { ItemSearch } from "@/features/stock/ItemSearch";
import { TransferSheet } from "@/features/stock/TransferSheet";
import { optionsCaption, targetFromItem, targetFromRow, type AdjustMode, type LowStockRow, type StockTarget } from "@/features/stock/model";
import { useLowStock } from "@/features/stock/queries";
import { useTerm, useTokens } from "@/theme/BrandProvider";
import { DataList, type Column } from "@/ui/DataList";
import { ArrowLineDown, ArrowsLeftRight, Warning } from "@/ui/icons";
import { Screen } from "@/ui/Screen";
import { Badge, Button, Chip, EmptyState, ErrorNote, Panel, SectionHeader, Segmented, Text, useLayout } from "@/ui/primitives";

type Pane = "low" | "find";

interface AdjustRequest {
  key: number;
  target: StockTarget | null;
  mode: AdjustMode;
}

/**
 * Stock at one store: what is running low (with the server's reorder suggestion),
 * a catalog search for any item, and the two write paths (adjust, transfer).
 * Wide screens show both panes; phones switch between them.
 */
export default function Stock() {
  const t = useTokens();
  const term = useTerm();
  const can = useCan();
  const me = useMe();
  const current = useStore();
  const { wide, gutter } = useLayout();

  const stores = me.data?.stores ?? [];
  const [pickedId, setPickedId] = useState<string | null>(null);
  const store: StoreInfo | null = stores.find((s) => s.id === pickedId) ?? current;
  const storeId = store?.id ?? null;
  const destinations = stores.filter((s) => s.id !== storeId);

  const [pane, setPane] = useState<Pane>("low");
  const [adjust, setAdjust] = useState<AdjustRequest | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const low = useLowStock(storeId);
  const rows = low.data;
  const canReceive = can("inventory.receive");
  const canAdjust = can("inventory.adjust");
  const canMove = canReceive || canAdjust;
  const canTransfer = can("inventory.transfer") && destinations.length > 0;
  const storeWord = term("Store").toLowerCase();

  const openAdjust = (target: StockTarget | null, mode: AdjustMode) => setAdjust((prev) => ({ key: (prev?.key ?? 0) + 1, target, mode }));

  const columns: Column<LowStockRow>[] = [
    {
      key: "item",
      header: "Item",
      flex: 3,
      render: (r) => (
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="label" numberOfLines={1} style={{ fontWeight: "600" }}>
            {r.name}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {optionsCaption(r.options, r.sku)}
          </Text>
        </View>
      ),
    },
    {
      key: "available",
      header: "Available",
      flex: 1.4,
      phone: true,
      render: (r) =>
        r.available <= 0 ? (
          <Badge tone="danger" label="Out of stock" icon={<Warning size={12} color={t.color.danger} />} />
        ) : (
          <Badge tone="warning" label={`${r.available} left`} icon={<Warning size={12} color={t.color.warning} />} />
        ),
    },
    {
      key: "reorder",
      header: "Reorder point",
      flex: 1,
      align: "right",
      phone: false,
      render: (r) => <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>{String(r.reorderPoint)}</Text>,
    },
    {
      key: "sold",
      header: "Sold in 28 days",
      flex: 1,
      align: "right",
      phone: false,
      render: (r) => <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>{String(r.sold28)}</Text>,
    },
    {
      key: "suggest",
      header: "Suggested order",
      flex: 1.2,
      align: "right",
      render: (r) => (
        <Text variant="label" tone={r.suggest > 0 ? "primary" : "muted"} style={{ fontVariant: ["tabular-nums"] }}>
          {r.suggest > 0 ? String(r.suggest) : "None"}
        </Text>
      ),
    },
  ];

  const lowEmpty = low.isError ? (
    <EmptyState title="Stock did not load" body="Try again in a moment." />
  ) : !storeId ? (
    <EmptyState title={`No ${storeWord} to show`} body="Your account is not linked to a store yet. Ask a manager." />
  ) : (
    <EmptyState title="All well stocked" body={`Nothing at this ${storeWord} is below its reorder point.`} />
  );

  const lowPane = (
    <View style={{ flex: 1 }}>
      {low.isError ? (
        <View style={{ padding: t.space(4) }}>
          <ErrorNote message="Low stock could not load. Check the connection and try again." onRetry={() => void low.refetch()} />
        </View>
      ) : null}
      <DataList
        label={`Running low at ${store?.name ?? "this store"}`}
        rows={rows}
        keyOf={(r) => r.variantId}
        columns={columns}
        onPress={(r) => openAdjust(targetFromRow(r), canReceive ? "receive" : "count")}
        loading={!!storeId && low.isPending}
        empty={lowEmpty}
      />
    </View>
  );

  const findPane = (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: t.space(4), gap: t.space(4) }} keyboardShouldPersistTaps="handled">
      <SectionHeader title="Find an item" description={canMove ? "Search the catalog. Counts are for this store." : undefined} />
      {!canMove ? (
        <EmptyState title="View only" body="Your role can see stock but not change it. Ask a manager to adjust or receive stock." />
      ) : storeId ? (
        <ItemSearch storeId={storeId} actionLabel="Adjust" onPick={(item) => openAdjust(targetFromItem(item), canAdjust ? "count" : "receive")} />
      ) : null}
    </ScrollView>
  );

  const toolbar =
    stores.length > 1 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space(2) }}>
        {stores.map((s) => (
          <Chip key={s.id} label={s.name} selected={s.id === storeId} onPress={() => setPickedId(s.id)} />
        ))}
      </ScrollView>
    ) : undefined;

  const actions =
    canReceive || canTransfer ? (
      <>
        {canReceive ? <Button label="Receive stock" icon={<ArrowLineDown size={18} color={t.color.onPrimary} />} disabled={!storeId} onPress={() => openAdjust(null, "receive")} /> : null}
        {canTransfer ? <Button kind="secondary" label="Transfer" icon={<ArrowsLeftRight size={18} color={t.color.text} />} disabled={!storeId} onPress={() => setTransferOpen(true)} /> : null}
      </>
    ) : undefined;

  return (
    <Screen title="Stock" subtitle={store ? `${store.name}. Running low, reorder suggestions and corrections.` : "Running low, reorder suggestions and corrections."} actions={actions} toolbar={toolbar} fill>
      {wide ? (
        <View style={{ flex: 1, flexDirection: "row", gap: t.space(5) }}>
          <Panel padded={false} style={{ flex: 1, minWidth: 0 }}>
            <View style={{ padding: t.space(4), paddingBottom: t.space(3) }}>
              <SectionHeader title="Running low" description="Below the reorder point or sold out. Press a row to record a delivery." />
            </View>
            {lowPane}
          </Panel>
          <Panel padded={false} style={{ width: 400 }}>
            {findPane}
          </Panel>
        </View>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: gutter, paddingBottom: gutter, gap: t.space(3) }}>
          <Segmented<Pane>
            label="Stock view"
            value={pane}
            onChange={setPane}
            size="lg"
            options={[
              { value: "low", label: `Running low (${rows?.length ?? 0})` },
              { value: "find", label: "Find an item" },
            ]}
          />
          <Panel padded={false} style={{ flex: 1 }}>
            {pane === "low" ? lowPane : findPane}
          </Panel>
        </View>
      )}

      {adjust && store ? (
        <AdjustSheet key={adjust.key} store={store} initialTarget={adjust.target} initialMode={adjust.mode} onClose={() => setAdjust(null)} />
      ) : null}
      {transferOpen && store && canTransfer ? <TransferSheet from={store} destinations={destinations} onClose={() => setTransferOpen(false)} /> : null}
    </Screen>
  );
}
