import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  RefreshControl,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewStyle,
} from "react-native";
import { messageOf } from "@/api/client";
import { colors, radius, space } from "@/theme";

export function T({
  variant = "body",
  style,
  ...rest
}: TextProps & { variant?: "title" | "h2" | "h3" | "body" | "small" | "muted" | "label" }) {
  return <Text {...rest} style={[styles[variant], style]} />;
}

export function Screen({
  children,
  refreshing,
  onRefresh,
  contentStyle,
  ...rest
}: ScrollViewProps & { refreshing?: boolean; onRefresh?: () => void; contentStyle?: ViewStyle }) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={[{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined
      }
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.row}>
        <T variant="h2" style={{ flex: 1 }}>
          {title}
        </T>
        {action}
      </View>
      {children}
    </View>
  );
}

type ButtonKind = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  title,
  kind = "primary",
  loading,
  disabled,
  icon,
  style,
  ...rest
}: Omit<PressableProps, "style"> & {
  title: string;
  kind?: ButtonKind;
  loading?: boolean;
  icon?: ReactNode;
  style?: ViewStyle;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      style={({ pressed }) => [
        styles.btn,
        styles[`btn_${kind}`],
        pressed && { opacity: 0.85 },
        off && { opacity: 0.5 },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={kind === "primary" || kind === "danger" ? "#fff" : colors.accent} />
      ) : (
        <>
          {icon}
          <Text style={[styles.btnText, styles[`btnText_${kind}`]]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  hint,
  ...rest
}: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <T variant="label">{label}</T>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, error ? { borderColor: colors.neg } : null, rest.multiline && { minHeight: 88 }]}
        {...rest}
      />
      {error ? (
        <T variant="small" style={{ color: colors.neg }}>
          {error}
        </T>
      ) : hint ? (
        <T variant="small">{hint}</T>
      ) : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} size="large" />
      {label ? <T variant="muted">{label}</T> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <T variant="h3" style={{ textAlign: "center" }}>
        {messageOf(error)}
      </T>
      {onRetry ? <Button title="Try again" kind="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={[styles.center, { paddingVertical: space.xxl }]}>
      <T variant="h3" style={{ textAlign: "center" }}>
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

export function Banner({ tone = "warn", children }: { tone?: "warn" | "neg" | "pos" | "info"; children: ReactNode }) {
  const map = {
    warn: { bg: colors.warnTint, fg: colors.warn },
    neg: { bg: colors.negTint, fg: colors.neg },
    pos: { bg: colors.posTint, fg: colors.pos },
    info: { bg: colors.accentTint, fg: colors.accentDeep },
  }[tone];
  return (
    <View style={{ backgroundColor: map.bg, borderRadius: radius.md, padding: space.md }}>
      {typeof children === "string" ? <Text style={{ color: map.fg, fontSize: 14 }}>{children}</Text> : children}
    </View>
  );
}

export function Pill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "pos" | "warn" | "neg" }) {
  const map = {
    neutral: { bg: colors.well, fg: colors.ink2 },
    pos: { bg: colors.posTint, fg: colors.pos },
    warn: { bg: colors.warnTint, fg: colors.warn },
    neg: { bg: colors.negTint, fg: colors.neg },
  }[tone];
  return (
    <View style={{ backgroundColor: map.bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Text style={{ color: map.fg, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Row({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <T variant={strong ? "h3" : "muted"} style={{ flex: 1 }}>
        {label}
      </T>
      {typeof value === "string" ? <T variant={strong ? "h3" : "body"}>{value}</T> : value}
    </View>
  );
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }} />;
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={[styles.chip, active && { backgroundColor: colors.ink, borderColor: colors.ink }]}
    >
      <Text style={{ color: active ? "#fff" : colors.ink, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: "700", color: colors.inkStrong, letterSpacing: -0.3 },
  h2: { fontSize: 19, fontWeight: "700", color: colors.inkStrong },
  h3: { fontSize: 16, fontWeight: "600", color: colors.ink },
  body: { fontSize: 15, color: colors.ink, lineHeight: 21 },
  small: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  muted: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: "600", color: colors.ink2 },
  card: {
    backgroundColor: colors.page,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  btn: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: space.sm,
  },
  btn_primary: { backgroundColor: colors.accent },
  btn_secondary: { backgroundColor: colors.page, borderWidth: 1, borderColor: colors.accentLine },
  btn_ghost: { backgroundColor: "transparent" },
  btn_danger: { backgroundColor: colors.neg },
  btnText: { fontSize: 16, fontWeight: "600" },
  btnText_primary: { color: "#fff" },
  btnText_secondary: { color: colors.accentDeep },
  btnText_ghost: { color: colors.accent },
  btnText_danger: { color: "#fff" },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.page,
    paddingHorizontal: space.md,
    fontSize: 16,
    color: colors.ink,
  },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.page,
  },
});
