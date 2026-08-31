import { Schema, model, models, type InferSchemaType } from 'mongoose'

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    fullname: { type: String, required: true },
    title: { type: String },
    avatarUrl: { type: String },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    isActive: { type: Boolean, default: true },
    // Self-registered accounts start 'pending' and can't log in until an Admin approves them
    // (see user.service.ts registerPendingUser/approveUser/rejectUser). Accounts created
    // directly via the Accounts page default to 'active' — no approval step for those.
    // Existing documents predating this field have no `status` at all; every check treats a
    // missing status as 'active' for backward compatibility (see auth.ts, session helpers).
    status: { type: String, enum: ['pending', 'active', 'rejected'], default: 'active' },
    lastLoginAt: { type: Date },
    // Cursor for the notification bell — items created after this are "unread". Null (including
    // for every pre-existing user) falls back to their createdAt in notification.service.ts, so
    // nobody is flooded with a backlog of "unread" history from before this field existed.
    notificationsReadAt: { type: Date, default: null },
    // Individually-read notifications newer than notificationsReadAt (e.g. clicked one item
    // without hitting "mark all as read"). Cleared whenever notificationsReadAt advances, since
    // the cursor then covers them — keeps this from growing unbounded.
    readNotificationIds: { type: [String], default: [] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

export type User = InferSchemaType<typeof userSchema>
export const UserModel = models.User ?? model('User', userSchema)
