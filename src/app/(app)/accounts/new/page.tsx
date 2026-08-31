import { Topbar } from '@/components/layout/Topbar'
import { Card } from '@/components/ui/Card'
import { NewAccountForm } from '@/components/accounts/NewAccountForm'
import { requireAbility } from '@/server/auth/session'
import * as userService from '@/server/services/user.service'

export default async function NewAccountPage() {
  await requireAbility({ action: 'create', subject: 'account' })

  const rolesRaw = await userService.listRoles()
  const roles = rolesRaw.map((r) => ({ id: String(r._id), name: r.name }))

  return (
    <>
      <Topbar title="New account" description="Add someone to your workspace" />

      <main className="flex-1 px-8 py-6 animate-fade-in">
        <Card className="mx-auto max-w-xl p-6">
          <NewAccountForm roles={roles} />
        </Card>
      </main>
    </>
  )
}
