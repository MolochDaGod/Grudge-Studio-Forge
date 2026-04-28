import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  type: text("type").notNull().default("other"),
  source: text("source").notNull().default("url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAssetSchema = createInsertSchema(assetsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
