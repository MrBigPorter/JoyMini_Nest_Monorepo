// Mock for next/dynamic — just renders the imported component synchronously
import React from 'react';

const dynamic = (
  importFn: () => Promise<{ default: React.ComponentType }>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: object,
): React.ComponentType => {
  // Return a lazy component that renders synchronously in tests
  const LazyComponent = React.lazy(importFn);
  const Wrapper: React.FC = (props) => (
    <React.Suspense fallback={<div data-testid="loading" />}>
      <LazyComponent {...props} />
    </React.Suspense>
  );
  Wrapper.displayName = 'DynamicMock';
  return Wrapper;
};

export default dynamic;
