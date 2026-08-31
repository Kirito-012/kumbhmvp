import { Schema, model, models, type InferSchemaType } from 'mongoose'

const tagSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    color: { type: String, default: '#818cf8' },
    usageCount: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export type Tag = InferSchemaType<typeof tagSchema>
export const TagModel = models.Tag ?? model('Tag', tagSchema)
