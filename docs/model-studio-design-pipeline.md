# Model Studio: how a building is designed and built

The agent designs a building one storey at a time. A storey is built only from a drawing that
passed the checks and was approved. After it is built, the model is compared with the drawing.

```
research → draw_floor_plan → automatic checks → fix and redraw
         → approve_floor_plan → build_floor → verification
```

## Why wrong designs used to get built

- **No research step.** The agent could draw before it had looked anything up.
- **One stair for every building.** Every flight used an 18 cm riser and a 27 cm tread, the
  landing was as deep as the flight was wide, and a U stair always had a 10 cm gap between its
  flights.
- **Missing checks.** Nothing checked:
  - the stair against the building's use (width, riser, stride, steps per flight, landing depth,
    headroom);
  - the stair hall as circulation (it could become a closed room, or open straight into a
    classroom);
  - a balustrade around the stairwell.
- **Weak gate.** `build_floor` could be forced past errors. There was no approval step, so a
  storey could be built as soon as it was drawn.
- **No comparison after building.** Nothing checked the built model against its drawing, for
  example after the storey above changed height.

## The stages

| Stage | Where | What it does |
|---|---|---|
| Research | `research` tool, `web-research.ts`, `knowledge.ts` | Searches the built-in knowledge, Wikipedia and the web, and reads passages from the pages found. Each query is saved in `doc.research`. `draw_floor_plan` is refused until at least one research has been done. |
| Stair design | `designStairs`, `stairRules` in `plans.ts` | Sets the rules from the building's use (housing or public). Fills in `riser` (the step count follows from the storey height), `tread` (Blondel's rule), `landing` and `gap` (U). `fillHall` widens a flight, or the gap of a U, so the stair fills its hall. |
| Checks | `checkPlan`, `stairDesignProblems`, `stairHallProblems`, `reviewStairs` | See the list below. |
| Approval | `approve_floor_plan` | Needs zero errors, a basis for the design and the designer's own review of each flight. Nothing may be left unverified (`unresolved`). Stores a hash of the drawing and of the storeys next to it. |
| Build | `build_floor`, `buildPlan` | Builds only an approved drawing that has not changed since. Each flight is built to its own design. Balustrades are added on the open edges of each stairwell (`wellGuards`). |
| Verification | `verifyBuilt` | Compares walls, slabs, slab holes, each flight (position, direction, steps, rise, tread, landing, gap) and the balustrades with the drawing. A deviation keeps the agent working. |

### What the checks cover

- **Rooms, walls and doors:** rooms, walls, doors and reachability.
- **Stair design:** width, riser, tread, 2h + b, steps per flight, landing, headroom above every
  tread, and whether the stair stands in a circulation space.
- **Stair hall:** must open onto circulation, must not be closed, and must not have a door
  straight into a functional room.
- **Placement:** flights must not overlap, no wall may cross a flight, and a flight must stand
  against a wall.
- **Foot and top:** the first tread faces the way in, and the top arrives in a room.
- **Between storeys:** the well, and the link to the storey above.

### How the agent run uses this

- **Progress every turn:** the agent is told, for each storey, whether it is approved, built,
  has errors, or differs from its drawing.
- **Finishing:** it cannot finish while a drawing has errors or the model differs from its
  drawing.
- **Missing data:** it can stop with `need_info` to ask the admin for data it cannot verify,
  instead of guessing.

## Generated geometry (from open-source research)

The agent can describe a storey as rooms on a grid and links between them, and let
`procedural.ts` produce the exact geometry. Each step is a small, deterministic port of an idea
from an MIT-licensed project or a paper; no code was copied wholesale and nothing runs a model.

| Step | Source | What we use it for |
|---|---|---|
| Rooms from grid bays (`roomsFromBays`) | wadi `floor-planner/src/spans.js` | Rooms tile without gaps or overlaps |
| Seam snapping (`snapSeams`) | Text2Floorplan `_cluster_1d`, `snap_global_seams` | 2.95 / 3.0 / 3.05 become one wall line; undone if it adds overlap |
| Walls from rooms (`wallsFromRooms`) | Text2Floorplan `revit_geometry.py`, wadi `wallsFromGraph.js` | Single-owner edge = exterior wall, shared edge = one partition, none inside an L room |
| Doors from links (`openLinks`, `placeEntrance`) | wadi `placeDoor`, Text2Floorplan door rules and `_repair_connectivity`, Procedural-Building-Generator island merging | Doors on the shared wall, clear of corners; unreachable rooms joined to circulation, never bedroom through bedroom |
| Windows by façade bays (`facadeBays`, `placeWindows`) | CGA shape grammar (Müller 2006): comp, repeat, occlusion, snap lines; sizes per room after Text2Floorplan | Windows only on exterior walls, evenly spaced, clear of doors and junctions, lined up with the storey below |
| Junction and door-zone checks (`junctionBands`, `doorZone`) | Aedifex `wall-mitering.ts`, `door-clearance.ts` | No opening cuts into a corner; no door swings over stairs |
| Roof from the footprint (`buildRoof`) | Aedifex `roof-footprint.ts`, Procedural-Building-Generator treemap footprint | L/T footprints split into blocks with one pitch, valleys where wings meet, gable ends closed |

Studied but not ported: Text2Floorplan's flow-matching network (needs a 193 MB model),
3D-GPT (no license, so only its pattern of asking per-tool questions), SceneCraft's render and
VLM critique loop (needs a vision model and an offscreen renderer), MCP4IFC's IFC tool set
(we do not use IFC), and Aedifex's mitred wall corners (our walls are boxes; left for later).

## Stair rules

These are design values within common building codes. Check them against the codes that apply
to each project.

| | Housing | Public (school, office, hospital, flats…) |
|---|---|---|
| Flight width | ≥ 0.9 m | ≥ 1.2 m |
| Riser | ≤ 18 cm | ≤ 16.5 cm |
| Tread | 25–32 cm | 28–34 cm |
| 2h + b | 58–67 cm | 58–67 cm |
| Steps per flight | ≤ 18 | ≤ 18 |
| Headroom | ≥ 2.0 m | ≥ 2.1 m |
| Stairwell balustrade | 0.95 m | 1.1 m |
