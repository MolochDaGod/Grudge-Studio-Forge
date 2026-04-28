import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, scriptsTable } from "@workspace/db";
import {
  CreateScriptBody,
  UpdateScriptBody,
  GetScriptParams,
  UpdateScriptParams,
  DeleteScriptParams,
  ListScriptsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const DEFAULT_JS = `// GameForge script — runs every frame in Play Mode
// 'entity' = the entity this script is attached to
// 'scene' = read-only access to other entities by name
// 'input' = { keys: { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Space, ... } }
// 'time' = { delta, elapsed }

export function start(entity, ctx) {
  // Called once when play starts
}

export function update(entity, ctx) {
  const { time, input } = ctx;
  // Spin the entity
  entity.rotation[1] += time.delta * 1.5;
}
`;

const DEFAULT_CS = `// GameForge C# script — compiled with Blazor WebAssembly
// using GameForge;

public class PlayerController : MonoBehaviour
{
    public float speed = 5.0f;

    public override void Start()
    {
        // Called once when play starts
    }

    public override void Update(float deltaTime)
    {
        if (Input.GetKey("ArrowUp"))
        {
            Transform.Position.Z -= speed * deltaTime;
        }
    }
}
`;

const formatScript = (s: typeof scriptsTable.$inferSelect) => ({
  ...s,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

router.get("/projects/:id/scripts", async (req, res) => {
  const { id } = ListScriptsParams.parse(req.params);
  const scripts = await db.select().from(scriptsTable).where(eq(scriptsTable.projectId, id));
  res.json(scripts.map(formatScript));
});

router.post("/scripts", async (req, res) => {
  const body = CreateScriptBody.parse(req.body);
  const defaultCode = body.language === "cs" ? DEFAULT_CS : DEFAULT_JS;
  const [script] = await db
    .insert(scriptsTable)
    .values({
      projectId: body.projectId,
      name: body.name,
      language: body.language,
      code: body.code ?? defaultCode,
    })
    .returning();
  res.status(201).json(formatScript(script));
});

router.get("/scripts/:id", async (req, res) => {
  const { id } = GetScriptParams.parse(req.params);
  const [script] = await db.select().from(scriptsTable).where(eq(scriptsTable.id, id));
  if (!script) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(formatScript(script));
});

router.patch("/scripts/:id", async (req, res) => {
  const { id } = UpdateScriptParams.parse(req.params);
  const body = UpdateScriptBody.parse(req.body);
  const [script] = await db
    .update(scriptsTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(scriptsTable.id, id))
    .returning();
  if (!script) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(formatScript(script));
});

router.delete("/scripts/:id", async (req, res) => {
  const { id } = DeleteScriptParams.parse(req.params);
  await db.delete(scriptsTable).where(eq(scriptsTable.id, id));
  res.status(204).end();
});

export default router;
