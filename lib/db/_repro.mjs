import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const t = pgTable("forge_projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
const db = drizzle(pool);
try {
  const r = await db.select().from(t).orderBy(t.updatedAt);
  console.log("OK", r);
} catch (e) {
  console.error("ERR", e.message);
  console.error("CAUSE_MSG", e.cause?.message);
  console.error("CAUSE_CODE", e.cause?.code);
  console.error("CAUSE_DETAIL", e.cause?.detail);
  console.error("CAUSE_POS", e.cause?.position);
  console.error("CAUSE_HINT", e.cause?.hint);
}
await pool.end();
