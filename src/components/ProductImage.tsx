import { Image } from "expo-image";
import { Text, View, type ViewStyle } from "react-native";
import { absoluteUrl } from "@/config";
import { colors, radius } from "@/theme";

/** A bottle on a white well (bottles shot on white look wrong on grey), or the brand's initials without a photo. */
export function ProductImage({
  url,
  name,
  size,
  style,
}: {
  url: string | null | undefined;
  name: string;
  size?: number;
  style?: ViewStyle;
}) {
  const src = absoluteUrl(url);
  const box: ViewStyle = {
    backgroundColor: "#fff",
    borderRadius: radius.md,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    ...(size ? { width: size, height: size } : { aspectRatio: 1, width: "100%" }),
  };
  return (
    <View style={[box, style]}>
      {src ? (
        <Image
          source={{ uri: src }}
          style={{ width: "100%", height: "100%" }}
          contentFit="contain"
          transition={150}
          accessibilityLabel={name}
          cachePolicy="memory-disk"
        />
      ) : (
        <Text style={{ color: colors.ghost, fontSize: size ? size / 3 : 32, fontWeight: "700" }}>
          {name
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0] ?? "")
            .join("")
            .toUpperCase()}
        </Text>
      )}
    </View>
  );
}
