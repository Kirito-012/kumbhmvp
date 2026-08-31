import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface User {
    roleKey?: string
    roleName?: string
    grants?: string[]
  }

  interface Session {
    user: {
      id: string
      roleKey: string
      roleName: string
      grants: string[]
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    roleKey?: string
    roleName?: string
    grants?: string[]
  }
}
