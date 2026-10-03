import {
  AlertTriangle,
  Car,
  CheckCircle2,
  Circle,
  Droplets,
  Flame,
  HeartPulse,
  Hourglass,
  LifeBuoy,
  type LucideIcon,
  Radio,
  Route,
  Shovel,
  ShieldCheck,
  Tent,
  Trash2,
  Users,
  Waves,
  Zap,
} from 'lucide-react'
import type { WorkStatus } from '@/lib/workHeads/demo'

// Shared by the Sector Report's Work heads tab and the dashboard's Work heads panels, so a head
// or a status looks the same wherever it appears.

export const STATUS_ORDER: WorkStatus[] = ['completed', 'in-progress', 'delayed', 'not-started']

export const STATUS_LABEL: Record<WorkStatus, string> = {
  completed: 'Completed',
  'in-progress': 'In progress',
  delayed: 'Delayed',
  'not-started': 'Not started',
}

export const STATUS_ICON: Record<WorkStatus, LucideIcon> = {
  completed: CheckCircle2,
  'in-progress': Hourglass,
  delayed: AlertTriangle,
  'not-started': Circle,
}

/** One icon per main head (keyed by head number in the planning document), so the list can be
 *  recognised by shape rather than read line by line. Unknown numbers fall back to a neutral dot. */
export const HEAD_ICON: Record<string, LucideIcon> = {
  '01': Shovel,
  '02': Route,
  '03': Droplets,
  '04': Waves,
  '05': Zap,
  '06': Tent,
  '07': Trash2,
  '08': Flame,
  '09': HeartPulse,
  '10': ShieldCheck,
  '11': Car,
  '12': LifeBuoy,
  '13': Users,
  '14': Radio,
}
