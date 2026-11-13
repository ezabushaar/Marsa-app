import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { useApi } from "@/api/hooks";
import { useSession } from "@/api/session";
import { colors, radius, space } from "@/theme";
import { T } from "./ui";

export type IconName = ComponentProps<typeof Ionicons>["name"];

/** A tappable settings-style row: icon, label, optional detail and chevron. */
export function ListItem({
  icon,
  label,
  detail,
  onPress,
  tone = "default",
  badge,
}: {
  icon: IconName;
  label: string;
  detail?: string | null;
  onPress: () => void;
  tone?: "default" | "danger";
  badge?: number;
}) {
  const color = tone === "danger" ? colors.neg : colors.accent;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      style={({ pressed }) => [s.item, pressed && { backgroundColor: colors.well }]}
    >
      <View style={[s.itemIcon, { backgroundColor: tone === "danger" ? colors.negTint : colors.accentTint }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={[s.itemLabel, tone === "danger" && { color: colors.neg }]}>{label}</Text>
      {badge ? (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge}</Text>
        </View>
      ) : null}
      {detail ? (
        <Text style={s.itemDetail} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.ghost} />
    </Pressable>
  );
}

/** A group of ListItems on one white card. */
export function ListGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      {title ? <Text style={s.groupTitle}>{title.toUpperCase()}</Text> : null}
      <View style={s.group}>{children}</View>
    </View>
  );
}

/** Two to four tabs inside a screen (Orders | Quotes). */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <View style={s.seg} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[s.segItem, on && s.segOn]}
          >
            <Text style={[s.segText, on && { color: colors.inkStrong }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A soft pulsing placeholder while a list loads. */
export function Skeleton({ style }: { style?: ViewStyle }) {
  const v = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ backgroundColor: colors.lineSoft, borderRadius: radius.md, opacity: v }, style]}
    />
  );
}

export function CardSkeletons({ count = 4 }: { count?: number }) {
  return (
    <View style={{ gap: space.md }} accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} style={{ height: 84 }} />
      ))}
    </View>
  );
}

/** The bag icon with the cart's line count, for screen headers. */
export function CartButton() {
  const { can } = useSession();
  const shops = can("shop");
  const cart = useApi(shop.getCart, undefined, { enabled: shops });
  if (!shops) return null;
  const lines = cart.data?.lines.length ?? 0;
  return (
    <Pressable
      onPress={() => router.push("/cart")}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={lines ? `Cart, ${lines} items` : "Cart"}
      style={{ paddingHorizontal: 6 }}
    >
      <Ionicons name="bag-handle-outline" size={25} color={colors.inkStrong} />
      {lines > 0 ? (
        <View style={[s.badge, { position: "absolute", top: -4, right: -4 }]}>
          <Text style={s.badgeText}>{lines > 99 ? "99+" : lines}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** A big friendly empty state with an icon. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", gap: space.md, paddingVertical: space.xxl, paddingHorizontal: space.lg }}>
      <View style={s.emptyIcon}>
        <Ionicons name={icon} size={34} color={colors.accent} />
      </View>
      <T variant="h2" style={{ textAlign: "center" }}>
        {title}
      </T>
      {body ? (
        <T variant="muted" style={{ textAlign: "center" }}>
          {body}
        </T>
      ) : null}
      {action}
    </View>
  );
}

/** A bar that fills toward a goal (order minimum, free freight). */
export function Progress({ value, tone = "accent" }: { value: number; tone?: "accent" | "warn" }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      style={s.progress}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
    >
      <View
        style={{
          width: `${pct * 100}%`,
          height: "100%",
          borderRadius: radius.pill,
          backgroundColor: tone === "accent" ? colors.accent : colors.warnDot,
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: 12,
    paddingHorizontal: space.lg,
    minHeight: 52,
  },
  itemIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  itemLabel: { flex: 1, fontSize: 16, color: colors.ink },
  itemDetail: { fontSize: 14, color: colors.muted, maxWidth: "45%" },
  group: {
    backgroundColor: colors.page,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: "hidden",
  },
  groupTitle: { fontSize: 12, fontWeight: "700", color: colors.muted, letterSpacing: 0.6, marginLeft: space.sm },
  seg: { flexDirection: "row", backgroundColor: colors.well, borderRadius: radius.md, padding: 3 },
  segItem: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 9 },
  segOn: {
    backgroundColor: colors.page,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segText: { fontSize: 14, fontWeight: "600", color: colors.muted },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.badge,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  progress: { height: 8, borderRadius: radius.pill, backgroundColor: colors.lineSoft, overflow: "hidden" },
});
