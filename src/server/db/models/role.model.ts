import { Schema, model, models, type InferSchemaType } from 'mongoose'

const roleSchema = new Schema(
  {
    key: { type: String, required: true, unique: true }, // 'admin' | 'manager' | 'surveyor' | 'customer'
    name: { type: String, required: true },
    description: { type: String },
    grants: { type: [String], default: [] },
    rank: { type: Number, required: true }, // lower = more powerful
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true },
)

export type Role = InferSchemaType<typeof roleSchema>
export const RoleModel = models.Role ?? model('Role', roleSchema)
