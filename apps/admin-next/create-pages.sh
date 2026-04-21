#!/bin/zsh
BASE="/Volumes/MySSD/work/dev/lucky_nest_monorepo/apps/admin-next/src/app/(dashboard)"
mkdir -p "$BASE/users" "$BASE/kyc" "$BASE/address" "$BASE/admin-users" "$BASE/products" "$BASE/categories" "$BASE/banners" "$BASE/groups" "$BASE/orders" "$BASE/marketing" "$BASE/finance" "$BASE/act/section" "$BASE/payment/channels"

pages=(
  "users:UserManagement:UserManagement"
  "kyc:KycList:KycList"
  "address:AddressList:AddressList"
  "admin-users:AdminUserManagement:AdminUserManagement"
  "products:ProductManagement:ProductManagement"
  "categories:CategoryManagement:CategoryManagement"
  "banners:BannerManagement:BannerManagement"
  "groups:GroupManagement:GroupManagement"
  "orders:OrderManagement:OrderManagement"
  "marketing:Marketing:Marketing"
  "finance:Finance:Finance"
  "act/section:ActSectionManagement:ActSectionManagement"
  "payment/channels:PaymentChannelList:PaymentChannelList"
)

for item in "${pages[@]}"; do
  route="${item%%:*}"
  rest="${item#*:}"
  component="${rest%%:*}"
  file="$BASE/$route/page.tsx"
  printf "'use client';\nimport { %s } from '@/pages/%s';\nexport default function Page() {\n  return <%s />;\n}\n" "$component" "$component" "$component" > "$file"
  echo " $route"
done

