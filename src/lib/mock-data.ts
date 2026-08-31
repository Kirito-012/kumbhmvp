export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type Status = 'new' | 'open' | 'pending' | 'resolved' | 'closed'

export interface Person {
  name: string
  initials: string
  color: string
}

export interface Ticket {
  id: string
  number: number
  subject: string
  preview: string
  group: string
  priority: Priority
  status: Status
  assignee: Person | null
  requester: Person
  tags: string[]
  updatedAt: string
  comments: number
}

export const people: Record<string, Person> = {
  aria: { name: 'Aria Chen', initials: 'AC', color: '#10b981' },
  marcus: { name: 'Marcus Lee', initials: 'ML', color: '#818cf8' },
  priya: { name: 'Priya Nair', initials: 'PN', color: '#60a5fa' },
  jordan: { name: 'Jordan Blake', initials: 'JB', color: '#fbbf24' },
  sofia: { name: 'Sofia Reyes', initials: 'SR', color: '#f472b6' },
  dev: { name: 'Devon Cruz', initials: 'DC', color: '#f87171' },
  unassigned: { name: 'Unassigned', initials: '—', color: '#4b5563' },
}

export const tickets: Ticket[] = [
  {
    id: 't1',
    number: 4821,
    subject: 'Checkout fails on Safari with 3-D Secure cards',
    preview: 'Customer reports payment sheet closes immediately after entering OTP...',
    group: 'Billing',
    priority: 'critical',
    status: 'open',
    assignee: people.aria,
    requester: { name: 'Wei Zhang', initials: 'WZ', color: '#9ca3af' },
    tags: ['payments', 'safari'],
    updatedAt: '4m ago',
    comments: 6,
  },
  {
    id: 't2',
    number: 4820,
    subject: 'Unable to reset password — reset link expires instantly',
    preview: 'Multiple users in the same org reporting the reset token is invalid...',
    group: 'Account',
    priority: 'high',
    status: 'new',
    assignee: null,
    requester: { name: 'Lena Fischer', initials: 'LF', color: '#9ca3af' },
    tags: ['auth', 'urgent'],
    updatedAt: '11m ago',
    comments: 2,
  },
  {
    id: 't3',
    number: 4819,
    subject: 'Feature request: bulk export tickets to CSV',
    preview: 'Would like a way to export filtered ticket views for offline reporting...',
    group: 'Product',
    priority: 'low',
    status: 'pending',
    assignee: people.marcus,
    requester: { name: 'Tom Ridley', initials: 'TR', color: '#9ca3af' },
    tags: ['feature-request'],
    updatedAt: '38m ago',
    comments: 3,
  },
  {
    id: 't4',
    number: 4818,
    subject: 'Dashboard widgets not loading for EU region tenants',
    preview: 'Widgets stuck on skeleton loaders, network tab shows 504 from edge...',
    group: 'Infrastructure',
    priority: 'critical',
    status: 'open',
    assignee: people.priya,
    requester: { name: 'Hugo Berg', initials: 'HB', color: '#9ca3af' },
    tags: ['outage', 'eu-region'],
    updatedAt: '52m ago',
    comments: 14,
  },
  {
    id: 't5',
    number: 4817,
    subject: 'Mobile app crashes when opening attachment previews',
    preview: 'Reproduced on iOS 17.4, only with PDF attachments over 5MB...',
    group: 'Mobile',
    priority: 'medium',
    status: 'open',
    assignee: people.jordan,
    requester: { name: 'Ines Moreau', initials: 'IM', color: '#9ca3af' },
    tags: ['mobile', 'crash'],
    updatedAt: '1h ago',
    comments: 5,
  },
  {
    id: 't6',
    number: 4816,
    subject: 'Onboarding checklist stuck at step 3 for new workspaces',
    preview: 'New workspace creation flow does not mark "Invite team" complete...',
    group: 'Onboarding',
    priority: 'medium',
    status: 'pending',
    assignee: people.sofia,
    requester: { name: 'Grace Oduya', initials: 'GO', color: '#9ca3af' },
    tags: ['onboarding'],
    updatedAt: '2h ago',
    comments: 1,
  },
  {
    id: 't7',
    number: 4815,
    subject: 'API rate limit errors during bulk sync',
    preview: 'Getting 429s in bursts even though we are under the documented limit...',
    group: 'API',
    priority: 'high',
    status: 'open',
    assignee: people.dev,
    requester: { name: 'Sam Okafor', initials: 'SO', color: '#9ca3af' },
    tags: ['api', 'rate-limit'],
    updatedAt: '3h ago',
    comments: 9,
  },
  {
    id: 't8',
    number: 4814,
    subject: 'Invoice PDF shows wrong tax rate for Canadian customers',
    preview: 'Tax line reads 5% GST but should be 13% HST for Ontario-based accounts...',
    group: 'Billing',
    priority: 'high',
    status: 'resolved',
    assignee: people.aria,
    requester: { name: 'Emily Trudeau', initials: 'ET', color: '#9ca3af' },
    tags: ['billing', 'tax'],
    updatedAt: '5h ago',
    comments: 4,
  },
  {
    id: 't9',
    number: 4813,
    subject: 'Slack integration stopped posting new-ticket notifications',
    preview: 'Webhook returns 200 but nothing posts in the connected channel...',
    group: 'Integrations',
    priority: 'medium',
    status: 'closed',
    assignee: people.marcus,
    requester: { name: 'Noah Kim', initials: 'NK', color: '#9ca3af' },
    tags: ['integrations', 'slack'],
    updatedAt: '1d ago',
    comments: 7,
  },
  {
    id: 't10',
    number: 4812,
    subject: 'Typo in the "Resolved" email template subject line',
    preview: 'Subject reads "You\'re ticket has been resolved" — should be "Your"...',
    group: 'Product',
    priority: 'low',
    status: 'closed',
    assignee: people.jordan,
    requester: { name: 'Ava Petrov', initials: 'AP', color: '#9ca3af' },
    tags: ['copy'],
    updatedAt: '1d ago',
    comments: 2,
  },
]

export const ticketVolume = [
  { day: 'Mon', created: 42, resolved: 38 },
  { day: 'Tue', created: 51, resolved: 46 },
  { day: 'Wed', created: 47, resolved: 49 },
  { day: 'Thu', created: 63, resolved: 55 },
  { day: 'Fri', created: 58, resolved: 60 },
  { day: 'Sat', created: 24, resolved: 30 },
  { day: 'Sun', created: 19, resolved: 22 },
]

export const priorityBreakdown = [
  { name: 'Critical', value: 8, color: '#f87171' },
  { name: 'High', value: 23, color: '#fbbf24' },
  { name: 'Medium', value: 41, color: '#60a5fa' },
  { name: 'Low', value: 30, color: '#34d399' },
]

export const topGroups = [
  { name: 'Billing', count: 86, share: 0.92 },
  { name: 'Infrastructure', count: 61, share: 0.66 },
  { name: 'Mobile', count: 47, share: 0.51 },
  { name: 'API', count: 39, share: 0.42 },
  { name: 'Onboarding', count: 22, share: 0.24 },
]

export const agentLeaderboard = [
  { person: people.aria, resolved: 58, avgHrs: 2.1 },
  { person: people.priya, resolved: 51, avgHrs: 2.6 },
  { person: people.marcus, resolved: 44, avgHrs: 3.2 },
  { person: people.sofia, resolved: 38, avgHrs: 3.8 },
]
