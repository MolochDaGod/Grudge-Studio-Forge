import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const scriptsTable = pgTable("forge_scripts", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  language: text("language").notNull().default("js"),
  code: text("code").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertScriptSchema = createInsertSchema(scriptsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertScript = z.infer<typeof insertScriptSchema>;
export type Script = typeof scriptsTable.$inferSelect;
