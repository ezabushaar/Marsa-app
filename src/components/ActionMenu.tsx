import { useState } from "react";
import { ActionSheetIOS, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space } from "@/theme";

export interface MenuAction {
  text: string;
  destructive?: boolean;
  run: () => void;
}

/**
 * A list of choices of any length: the native action sheet on iOS, a bottom sheet on Android (whose system alert
 * holds only three buttons). Render `menu` once in the screen and call `open(title, actions)`.
 */
export function useActionMenu() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<{ title: string; actions: MenuAction[] } | null>(null);

  const open = (title: string, actions: MenuAction[]) => {
    if (Platform.OS === "ios") {
      const destructive = actions.findIndex((a) => a.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options: [...actions.map((a) => a.text), "Cancel"],
          cancelButtonIndex: actions.length,
          ...(destructive >= 0 ? { destructiveButtonIndex: destructive } : {}),
        },
        (i) => actions[i]?.run(),
      );
    } else {
      setState({ title, actions });
    }
  };

  const close = () => setState(null);
  const menu = (
    <Modal visible={!!state} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={s.backdrop} onPress={close} accessibilityLabel="Close menu" />
      <View style={[s.sheet, { paddingBottom: insets.bottom + space.md }]}>
        <Text style={s.title}>{state?.title}</Text>
        <ScrollView style={{ maxHeight: 420 }}>
          {state?.actions.map((a) => (
            <Pressable
              key={a.text}
              style={({ pressed }) => [s.item, pressed && { backgroundColor: colors.well }]}
              onPress={() => {
                close();
                a.run();
              }}
              accessibilityRole="button"
            >
              <Text style={[s.itemText, a.destructive && { color: colors.neg }]}>{a.text}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable style={[s.item, { alignItems: "center" }]} onPress={close} accessibilityRole="button">
          <Text style={[s.itemText, { fontWeight: "700" }]}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );

  return { open, menu };
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: colors.page,
    borderTopLeftRadius: radius.lg * 1.25,
    borderTopRightRadius: radius.lg * 1.25,
    paddingTop: space.md,
  },
  title: { fontSize: 13, color: colors.muted, textAlign: "center", paddingBottom: space.sm, fontWeight: "600" },
  item: { paddingVertical: 16, paddingHorizontal: space.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.lineSoft },
  itemText: { fontSize: 17, color: colors.ink },
});
