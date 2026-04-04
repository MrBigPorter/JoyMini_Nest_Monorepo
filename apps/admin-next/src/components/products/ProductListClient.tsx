'use client';

import React from 'react';
import { ProductManagement } from './ProductManagementClient';

interface ProductListClientProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

export function ProductListClient(props: ProductListClientProps) {
  return <ProductManagement {...props} />;
}
