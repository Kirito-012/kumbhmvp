import MapView from '@/components/map/MapView'
import { requireTicketScope } from '@/server/auth/session'
import { canUseMapModes } from '@/server/auth/ability'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { ability } = await requireTicketScope()
  // Admin/Manager get the full mode switcher. Surveyors are locked to Ticket mode only (no Map,
  // Heatmap or Evacuation) -- /api/insights/* admits them, /api/evacuation/* stays read:all.
  const canUseInsights = canUseMapModes(ability)
  const ticketModeOnly = !ability.can('read:all', 'ticket')

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

  return (
    <MapView
      initialParcel={initialParcel}
      canUseInsights={canUseInsights}
      ticketModeOnly={ticketModeOnly}
    />
  )
}
