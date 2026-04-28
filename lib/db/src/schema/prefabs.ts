import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const prefabsTable = pgTable("prefabs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  data: jsonb("data").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPrefabSchema = createInsertSchema(prefabsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPrefab = z.infer<typeof insertPrefabSchema>;
export type Prefab = typeof prefabsTable.$inferSelect;
