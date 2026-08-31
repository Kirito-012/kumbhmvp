'use client'

import { useEffect, useRef } from 'react'
import { Map as MLMap, Marker, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// Idempotent with the same call in MapView.tsx — safe even though only one of the two modules
// ever loads on a given page (this component and the full map never render together).
setWorkerUrl('/maplibre-gl-worker.mjs')

/** Small, non-interactive map thumbnail centered on a single point — used on the ticket detail
 *  page to show a map-parcel ticket's location without pulling in the full interactive map. */
export function TicketLocationMap({ lng, lat }: { lng: number; lat: number }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current) return

    const map = new MLMap({
      container: container.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [lng, lat],
      zoom: 15,
      interactive: false,
      attributionControl: false,
    })

    new Marker({ color: '#2563eb' }).setLngLat([lng, lat]).addTo(map)

    return () => {
      map.remove()
    }
  }, [lng, lat])

  return <div ref={container} className="h-40 w-full overflow-hidden rounded-lg" />
}
