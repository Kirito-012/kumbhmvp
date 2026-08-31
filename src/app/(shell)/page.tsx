import MapView from '@/components/map/MapView'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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

  return <MapView initialParcel={initialParcel} />
}
