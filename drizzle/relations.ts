import { relations } from "drizzle-orm";
import { users, profiles, watchlist, priceAlerts, notifications, kycQueue } from "./schema";

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
  watchlist: many(watchlist),
  priceAlerts: many(priceAlerts),
  notifications: many(notifications),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.userId], references: [users.id] }),
}));

export const watchlistRelations = relations(watchlist, ({ one }) => ({
  user: one(users, { fields: [watchlist.userId], references: [users.id] }),
}));

export const priceAlertsRelations = relations(priceAlerts, ({ one }) => ({
  user: one(users, { fields: [priceAlerts.userId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const kycQueueRelations = relations(kycQueue, ({ one }) => ({
  profile: one(profiles, { fields: [kycQueue.profileId], references: [profiles.id] }),
  user: one(users, { fields: [kycQueue.userId], references: [users.id] }),
}));
