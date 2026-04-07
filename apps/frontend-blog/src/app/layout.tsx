// 正确的根布局：不做任何事情，只透传内容
// 所有逻辑、样式、HTML骨架全部移到 [locale] 层布局
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
