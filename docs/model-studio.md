# Model Studio

Studio → **Model** (`/studio/models`): build, assemble, check and publish 3D models for the game in the browser, by hand or through the AI agent.

## Architecture

| Layer | Where | What |
|---|---|---|
| Model kit (shared, pure TS) | `packages/assets/src/model-studio` | Project document (`doc.ts`), procedural meshes (`mesh.ts`: primitives, rocks, walls with openings, slabs with holes, stairs, roofs), PBR material presets (`materials.ts`), procedural PBR textures (`textures.ts`: base colour, normal, roughness, metalness, AO), house generator (`house.ts`), furniture (`furniture.ts`), validation and auto-fix (`validate.ts`), GLB writer/reader (`gltf.ts`, `png.ts`), export (`export.ts`), game asset definition (`game-asset.ts`), agent tools (`tools.ts`), reference knowledge (`knowledge.ts`). |
| Server | `apps/server/src/model-studio` | Persistence (`store.ts`; migration `032_model_studio.sql`), LLM client (`llm.ts`, after model-generator's client), agent loop (`agent.ts`), built-in planner (`planner.ts`). Routes in `apps/server/src/http/routes/model-studio.ts`. |
| Browser | `apps/web/src/components/model-studio`, `apps/web/src/studio/model-studio/viewport.ts` | Editor UI and three.js viewport. |

The project document holds parameters, not baked triangles: every part stays editable by the admin and the agent. The same code makes meshes and textures in the browser preview and in the server export.

## Agent

- The language model reasons in JSON turns: `thought`, `plan`, `actions: [{tool, args}]`, then `done`. Every change goes through a tool in `tools.ts`; results go back to the model.
- Limits: 24 turns, 8 actions per turn, 2 repair rounds after the final validation, one job per project.
- The agent's result is saved as a project version (author `agent`), and undo restores what was there before.
- Permissions: the agent edits only its project. `export_asset` with `publish: true` files a request; the admin confirms it in the Studio.
- Without `AI_API_KEY` the built-in planner runs the same tools for houses, rocks and kit assemblies.

### Configuration (server environment only)

| Variable | Default |
|---|---|
| `AI_API_KEY` | none |
| `AI_BASE_URL` | `https://ai.mangso.net/v1` |
| `AI_MODEL` | `cx/gpt-5.6-sol` |
| `AI_TIMEOUT_MS` | `180000` |
| `AI_MAX_RETRIES` | `3` |

The key is sent only in the Authorization header and is redacted from errors.

## Into the game

- **Publish** builds a game GLB: procedural geometry merged per material, one draw call per material.
  - It is stored in `model_assets` under an id in 3000–3999 and registered at runtime on servers, chunk workers and clients.
  - Collision is the model's own opaque triangles, through a solid box and the hit mesh. Glass, leaves and cloth, and parts marked `collision: none`, do not collide.
  - Game models used in the project (trees, chairs) are not copied. They become `composite` placements, expanded wherever the model is placed and drawn instanced.
- **World Studio:** published buildings with a lot class (`lot:residential`…) join the settlement generator's catalogue.
- **Built-in BR island trial:** "Thử trên đảo BR" puts the selected houses on every other outskirts home plot.
  - Takes effect at server restart. The world id changes, so clients don't reuse stale chunks.

## Limits

- Imports and exports: GLB/GLTF without Draco/meshopt compression. Animations are not kept when merging.
- Bbmodel/procedural game models can't be embedded into a GLB. They stay as references.
- Doorways are openings. The BR mode's interactive doors are placed by maps, not by models.
- The viewport previews textures at 256². Exports use each material's resolution (256/512/1024).
- AI image texture generation isn't wired in. Imported PNG/JPEG images can replace a material's base colour.
