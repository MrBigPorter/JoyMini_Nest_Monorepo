'use client';

import { MapPin } from 'lucide-react';
import { resolveMediaUrl } from '@/lib/media-utils';

export function LocationMessage({
  meta,
}: {
  meta: Record<string, unknown> | null;
}) {
  const thumb = meta?.thumb as string | undefined;
  const title = (meta?.title as string) ?? 'Location';
  const address = meta?.address as string | undefined;
  const lat = meta?.latitude as number | undefined;
  const lng = meta?.longitude as number | undefined;
  const mapsUrl =
    lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : undefined;

  return (
    <a
      href={mapsUrl ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl overflow-hidden w-48 group"
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolveMediaUrl(thumb)}
          alt="map"
          className="w-full h-28 object-cover group-hover:opacity-90 transition-opacity"
        />
      ) : (
        <div className="w-full h-28 bg-gray-200 dark:bg-white/10 flex items-center justify-center">
          <MapPin size={24} className="text-gray-400" />
        </div>
      )}
      <div className="px-2 py-1.5 bg-white dark:bg-gray-800">
        <p className="text-xs font-medium text-gray-800 dark:text-white truncate">
          {title}
        </p>
        {address && <p className="text-xs text-gray-400 truncate">{address}</p>}
      </div>
    </a>
  );
}
