import { useState, useCallback } from 'react';
import { ModalManager } from '@repo/ui';

// Generic hook to handle list data with simulated delay
export function useMockData<T extends { id: string }>(initialData: T[]) {
  const [data, setData] = useState<T[]>(initialData);
  const [loading, setLoading] = useState(false);

  // Simulate fetch
  const refresh = useCallback(() => {
    setLoading(true);
    setTimeout(() => setLoading(false), 600);
  }, []);

  const add = (item: T) => {
    setLoading(true);
    setTimeout(() => {
      setData((prev) => [...prev, item]);
      setLoading(false);
    }, 500);
  };

  const update = (id: string, updatedItem: Partial<T>) => {
    setLoading(true);
    setTimeout(() => {
      setData((prev) =>
        prev.map((item: T) =>
          item.id === id ? { ...item, ...updatedItem } : item,
        ),
      );
      setLoading(false);
    }, 500);
  };

  const remove = (id: string, requireConfirm = true) => {
    const runRemove = () => {
      setLoading(true);
      setTimeout(() => {
        setData((prev) => prev.filter((item: T) => item.id !== id));
        setLoading(false);
      }, 500);
    };

    if (!requireConfirm) {
      runRemove();
      return;
    }

    ModalManager.open({
      title: 'Delete Item',
      content: 'Are you sure you want to delete this item?',
      confirmText: 'Delete',
      onConfirm: runRemove,
    });
  };

  return { data, loading, add, update, remove, refresh };
}
