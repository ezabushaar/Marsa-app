import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type QtyRules, stepDown, stepUp } from "@contracts/routes/portal/shop";
import { colors, radius } from "@/theme";

/** − qty + with the ERP's own quantity rules (minimum, pack size, most per order). */
export function QtyStepper({
  value,
  rules,
  onChange,
  compact,
  onRemove,
}: {
  value: number;
  rules: Pick<QtyRules, "min" | "max" | "step">;
  onChange: (n: number) => void;
  compact?: boolean;
  /** Shown instead of − at the minimum (a cart line). */
  onRemove?: () => void;
}) {
  const atMin = value <= rules.min;
  const atMax = rules.max !== null && value >= rules.max;
  const size = compact ? 34 : 42;
  return (
    <View style={[s.wrap, { height: size }]}>
      <Pressable
        accessibilityLabel={atMin && onRemove ? "Remove" : "Less"}
        disabled={atMin && !onRemove}
        onPress={() => (atMin && onRemove ? onRemove() : onChange(stepDown(value, rules)))}
        style={[s.btn, { width: size }, atMin && !onRemove && { opacity: 0.35 }]}
        hitSlop={6}
      >
        <Ionicons name={atMin && onRemove ? "trash-outline" : "remove"} size={18} color={colors.ink} />
      </Pressable>
      <Text style={[s.value, compact && { fontSize: 14, minWidth: 34 }]} accessibilityLabel={`Quantity ${value}`}>
        {value}
      </Text>
      <Pressable
        accessibilityLabel="More"
        disabled={atMax}
        onPress={() => onChange(stepUp(value, rules))}
        style={[s.btn, { width: size }, atMax && { opacity: 0.35 }]}
        hitSlop={6}
      >
        <Ionicons name="add" size={18} color={colors.ink} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.page,
    alignSelf: "flex-start",
  },
  btn: { alignItems: "center", justifyContent: "center", height: "100%" },
  value: { minWidth: 44, textAlign: "center", fontSize: 16, fontWeight: "600", color: colors.ink },
});
