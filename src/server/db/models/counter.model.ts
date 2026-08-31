import { Schema, model, models } from 'mongoose'

const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
})

export const CounterModel = models.Counter ?? model('Counter', counterSchema)

/** Atomically returns the next integer in the named sequence (e.g. 'tickets'). */
export async function nextSequence(name: string): Promise<number> {
  const doc = await CounterModel.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  )
  return doc!.seq
}
