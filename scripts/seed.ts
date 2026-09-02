import { config } from 'dotenv'
config({ path: '.env.local' })

import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { dbConnect } from '../src/server/db/connect'
import { RoleModel } from '../src/server/db/models/role.model'
import { UserModel } from '../src/server/db/models/user.model'
import { TicketStatusModel } from '../src/server/db/models/ticket-status.model'
import { TicketPriorityModel } from '../src/server/db/models/ticket-priority.model'
import { TicketTypeModel } from '../src/server/db/models/ticket-type.model'

const ALL_GRANTS = [
  'ticket:read:own',
  'ticket:read:group',
  'ticket:read:all',
  'ticket:create',
  'ticket:update',
  'ticket:delete',
  'ticket:assign',
  'ticket:merge',
  'comment:create',
  'comment:update:own',
  'comment:update:any',
  'comment:delete',
  'note:read',
  'note:create',
  'attachment:create',
  'attachment:delete',
  'account:read',
  'account:create',
  'account:update',
  'account:delete',
  'group:manage',
  'team:manage',
  'department:manage',
  'report:view',
  'report:generate',
  'notice:manage',
  'settings:manage',
  'role:manage',
]

const ROLES = [
  { key: 'admin', name: 'Admin', rank: 0, isSystem: true, grants: ALL_GRANTS },
  {
    key: 'manager',
    name: 'Manager',
    rank: 1,
    isSystem: true,
    grants: [
      'ticket:read:all',
      'ticket:create',
      'ticket:update',
      'ticket:assign',
      'ticket:merge',
      'comment:create',
      'comment:update:own',
      'comment:update:any',
      'comment:delete',
      'note:read',
      'note:create',
      'attachment:create',
      'attachment:delete',
      'account:read',
      'account:create',
      'account:update',
      'group:manage',
      'team:manage',
      'department:manage',
      'report:view',
      'report:generate',
      'notice:manage',
    ],
  },
  {
    key: 'surveyor',
    name: 'Surveyor',
    rank: 2,
    isSystem: true,
    // 'own' not 'group' — Groups/Teams/Departments aren't built. A Surveyor's ticket list and
    // dashboard are scoped server-side to assigneeId === self (see requireTicketScope() in
    // src/server/auth/session.ts). ticket:assign is NOT granted — only Admin/Manager assign.
    grants: [
      'ticket:read:own',
      'ticket:create',
      'ticket:update',
      'comment:create',
      'comment:update:own',
      'note:read',
      'note:create',
      'attachment:create',
      'account:read',
      'report:view',
    ],
  },
] as const

const STATUSES = [
  { name: 'New', slug: 'new', color: '#818cf8', order: 0, isResolved: false, isDefault: true },
  { name: 'Open', slug: 'open', color: '#10b981', order: 1, isResolved: false, isDefault: false },
  {
    name: 'Pending',
    slug: 'pending',
    color: '#f59e0b',
    order: 2,
    isResolved: false,
    isDefault: false,
  },
  {
    name: 'Resolved',
    slug: 'resolved',
    color: '#34d399',
    order: 3,
    isResolved: true,
    isDefault: false,
  },
  {
    name: 'Closed',
    slug: 'closed',
    color: '#6b7280',
    order: 4,
    isResolved: true,
    isDefault: false,
  },
]

const PRIORITIES = [
  { name: 'Low', slug: 'low', color: '#818cf8', order: 0, slaHours: 72, overdueAfterHours: 96 },
  {
    name: 'Normal',
    slug: 'normal',
    color: '#10b981',
    order: 1,
    slaHours: 24,
    overdueAfterHours: 36,
  },
  { name: 'High', slug: 'high', color: '#f59e0b', order: 2, slaHours: 8, overdueAfterHours: 12 },
  {
    name: 'Critical',
    slug: 'critical',
    color: '#f87171',
    order: 3,
    slaHours: 2,
    overdueAfterHours: 4,
  },
]

const TYPES = [
  { name: 'Issue', slug: 'issue' },
  { name: 'Question', slug: 'question' },
  { name: 'Task', slug: 'task' },
  // Created via POST /api/v1/tickets by the DroneSeva integration — see src/app/api/v1/tickets.
  { name: 'Garbage Detection', slug: 'garbage-detection' },
  // Created via scripts/import-map-tickets.ts — one ticket per kumbh.sector_plan parcel.
  { name: 'Map Parcel', slug: 'map-parcel' },
]

async function seed() {
  await dbConnect()

  console.log('Seeding roles...')
  const roleDocs: Record<string, string> = {}
  for (const role of ROLES) {
    const doc = await RoleModel.findOneAndUpdate(
      { key: role.key },
      { $set: role },
      { upsert: true, returnDocument: 'after' },
    )
    roleDocs[role.key] = doc._id.toString()
  }

  console.log('Seeding statuses...')
  for (const status of STATUSES) {
    await TicketStatusModel.findOneAndUpdate(
      { slug: status.slug },
      { $set: status },
      { upsert: true },
    )
  }

  console.log('Seeding priorities...')
  const priorityIds: Record<string, string> = {}
  for (const priority of PRIORITIES) {
    const doc = await TicketPriorityModel.findOneAndUpdate(
      { slug: priority.slug },
      { $set: priority },
      { upsert: true, returnDocument: 'after' },
    )
    priorityIds[priority.slug] = doc._id.toString()
  }

  console.log('Seeding types...')
  for (const type of TYPES) {
    await TicketTypeModel.findOneAndUpdate(
      { slug: type.slug },
      {
        $set: {
          ...type,
          allowedPriorityIds: Object.values(priorityIds),
          defaultPriorityId: priorityIds.normal,
        },
      },
      { upsert: true },
    )
  }

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@thecraftsync.local').toLowerCase()
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!'

  console.log(`Seeding admin user (${adminEmail})...`)
  const passwordHash = await bcrypt.hash(adminPassword, 12)
  await UserModel.findOneAndUpdate(
    { email: adminEmail },
    {
      $set: {
        email: adminEmail,
        passwordHash,
        fullname: 'Admin',
        roleId: roleDocs.admin,
        isActive: true,
        deletedAt: null,
      },
    },
    { upsert: true },
  )

  // Loginable test accounts for exercising the Manager/Surveyor roles (not service accounts —
  // these have a real, fixed password so someone can actually log in as each role).
  const testAccounts = [
    { email: 'manager@test.local', fullname: 'Test Manager', roleKey: 'manager' },
    { email: 'surveyor@test.local', fullname: 'Test Surveyor', roleKey: 'surveyor' },
  ] as const
  const testPassword = 'testpass123'
  const testPasswordHash = await bcrypt.hash(testPassword, 12)
  for (const account of testAccounts) {
    console.log(`Seeding test ${account.roleKey} account (${account.email})...`)
    await UserModel.findOneAndUpdate(
      { email: account.email },
      {
        $set: {
          email: account.email,
          passwordHash: testPasswordHash,
          fullname: account.fullname,
          roleId: roleDocs[account.roleKey],
          isActive: true,
          deletedAt: null,
        },
      },
      { upsert: true },
    )
  }

  // Service-account "reporter" for tickets auto-created via POST /api/v1/tickets (DroneSeva
  // integration). Never logs in — password is a random value that's discarded immediately.
  const botEmail = 'droneseva-bot@thecraftsync.local'
  console.log(`Seeding integration service account (${botEmail})...`)
  const botPasswordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12)
  const botUser = await UserModel.findOneAndUpdate(
    { email: botEmail },
    {
      $set: {
        email: botEmail,
        passwordHash: botPasswordHash,
        fullname: 'DroneSeva',
        roleId: roleDocs.surveyor,
        isActive: true,
        deletedAt: null,
      },
    },
    { upsert: true, returnDocument: 'after' },
  )

  // Service-account "reporter" for tickets bulk-created via scripts/import-map-tickets.ts.
  // Kept separate from the DroneSeva bot above since it represents a different ticket source.
  const importEmail = 'kumbh-import-bot@thecraftsync.local'
  console.log(`Seeding map-import service account (${importEmail})...`)
  const importPasswordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12)
  const importBotUser = await UserModel.findOneAndUpdate(
    { email: importEmail },
    {
      $set: {
        email: importEmail,
        passwordHash: importPasswordHash,
        fullname: 'Kumbh Map Import',
        roleId: roleDocs.surveyor,
        isActive: true,
        deletedAt: null,
      },
    },
    { upsert: true, returnDocument: 'after' },
  )

  console.log(
    '\nDone. Seeded 3 roles, 5 statuses, 4 priorities, 5 types, 1 admin user, 2 test accounts, and 2 service accounts.',
  )
  console.log(`Log in with: ${adminEmail} / ${adminPassword}`)
  for (const account of testAccounts) {
    console.log(`Log in with: ${account.email} / ${testPassword}`)
  }
  console.log(`DroneSeva integration service-account id: ${botUser._id.toString()} (${botEmail})`)
  console.log(`Map-import service-account id: ${importBotUser._id.toString()} (${importEmail})`)
  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
