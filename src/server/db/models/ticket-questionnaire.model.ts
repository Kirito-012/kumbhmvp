import { Schema, model, models, type InferSchemaType } from 'mongoose'

const questionnaireAnswerSchema = new Schema(
  {
    questionId: { type: String, required: true },
    skipped: { type: Boolean, default: false },
    choice: { type: String, enum: ['yes', 'no', 'na'], default: null },
    required: { type: Number, default: null },
    actual: { type: Number, default: null },
    length: { type: Number, default: null },
    width: { type: Number, default: null },
    value: { type: Number, default: null },
    text: { type: String, default: null },
  },
  { _id: false },
)

const ticketQuestionnaireSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true },
    commentId: { type: Schema.Types.ObjectId, ref: 'TicketComment', default: null },
    surveyorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    templateKey: { type: String, required: true },
    version: { type: Number, required: true },
    answers: { type: [questionnaireAnswerSchema], default: [] },
    remarks: { type: String, default: null }, // sanitized HTML
    // Denormalized off ticket.location at submit time — keeps a submission's site context
    // readable/reportable even if the ticket's location is later edited or cleared.
    locationSnapshot: {
      sectorNo: { type: Number, default: null },
      block: { type: String, default: null },
      plotNo: { type: String, default: null },
      classGroup: { type: String, default: null },
    },
    answeredCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

ticketQuestionnaireSchema.index({ ticketId: 1, createdAt: -1 })

export type TicketQuestionnaire = InferSchemaType<typeof ticketQuestionnaireSchema>
export const TicketQuestionnaireModel =
  models.TicketQuestionnaire ?? model('TicketQuestionnaire', ticketQuestionnaireSchema)
