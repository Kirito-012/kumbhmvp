import MapView from '@/components/map/MapView'
import { requireTicketScope } from '@/server/auth/session'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { ability } = await requireTicketScope()
  // Heatmap/Ticket modes are Admin & Manager only -- surveyors never see the switch (not just a
  // hidden UI: /api/insights/* enforce the same grant server-side, see those routes).
  const canUseInsights = ability.can('read:all', 'ticket')

  const sp = await searchParams
  const get = (key: string) => (Array.isArray(sp[key]) ? sp[key][0] : sp[key])

  const parcel = get('parcel')
  const lng = get('lng')
  const lat = get('lat')
  const sector = get('sector')

  const initialParcel =
    parcel &&
    lng &&
    lat &&
    Number.isFinite(Number(parcel)) &&
    Number.isFinite(Number(lng)) &&
    Number.isFinite(Number(lat))
      ? {
          sectorPlanId: Number(parcel),
          lng: Number(lng),
          lat: Number(lat),
          sectorNo: sector && Number.isFinite(Number(sector)) ? Number(sector) : null,
        }
      : null

  return <MapView initialParcel={initialParcel} canUseInsights={canUseInsights} />
}
