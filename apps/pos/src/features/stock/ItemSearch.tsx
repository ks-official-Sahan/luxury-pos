import { useDeferredValue, useState } from "react";
import { View } from "react-native";
import type { CatalogItem } from "@/state/cart";
import { useTokens } from "@/theme/BrandProvider";
import { Check, MagnifyingGlass, X } from "@/ui/icons";
import { Badge, Button, EmptyState, ErrorNote, Field, IconButton, Row, Skeleton, Text } from "@/ui/primitives";
import { MIN_STOCK_QUERY, optionsCaption } from "./model";
import { useStockSearch } from "./queries";

interface ItemSearchProps {
  storeId: string;
  /** Label of the per-row action, for example "Adjust" or "Add". */
  actionLabel: string;
  onPick: (item: CatalogItem) => void;
  /** Rows already chosen elsewhere show an "Added" badge instead of the action. */
  isPicked?: (item: CatalogItem) => boolean;
  isDisabled?: (item: CatalogItem) => boolean;
}

/** Name, SKU or barcode search with the on-hand count at one store. Plain list: results are capped at 20. */
export function ItemSearch({ storeId, actionLabel, onPick, isPicked, isDisabled }: ItemSearchProps) {
  const t = useTokens();
  const [text, setText] = useState("");
  const term = useDeferredValue(text.trim());
  const search = useStockSearch(storeId, term);
  const items = search.data ?? [];
  const searching = term.length >= MIN_STOCK_QUERY;

  return (
    <View style={{ gap: t.space(3) }}>
      <Field
        label="Name, SKU or barcode"
        value={text}
        onChangeText={setText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        leading={<MagnifyingGlass size={18} color={t.color.textMuted} />}
        trailing={
          text ? (
            <IconButton label="Clear search" size="sm" onPress={() => setText("")}>
              <X size={18} color={t.color.text} />
            </IconButton>
          ) : undefined
        }
      />
      {!searching ? (
        <Text variant="caption" tone="muted">
          {`Type at least ${MIN_STOCK_QUERY} characters. Counts are for this store.`}
        </Text>
      ) : null}
      {search.isError ? <ErrorNote message="Search did not load. Check the connection and try again." onRetry={() => void search.refetch()} /> : null}
      {searching && search.isPending ? (
        <View style={{ gap: t.space(3) }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={40} />
          ))}
        </View>
      ) : null}
      {searching && search.isSuccess && items.length === 0 ? <EmptyState title="No items match" body="Check the spelling, or search by SKU or barcode." /> : null}
      {items.map((item) => {
        const available = item.available ?? 0;
        return (
          <Row key={item.variantId} gap={3} style={{ minHeight: t.hit, paddingVertical: t.space(2), borderBottomWidth: 1, borderBottomColor: t.color.border }}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="label" numberOfLines={1} style={{ fontWeight: "600" }}>
                {item.name}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {`${optionsCaption(item.options, item.sku)} · ${available} available`}
              </Text>
            </View>
            {isPicked?.(item) ? (
              <Badge tone="success" label="Added" icon={<Check size={14} color={t.color.success} />} />
            ) : (
              <Button kind="ghost" size="sm" label={actionLabel} disabled={isDisabled?.(item)} onPress={() => onPick(item)} />
            )}
          </Row>
        );
      })}
    </View>
  );
}
