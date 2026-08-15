/** The sessionStorage keys Studio and My Designs write, and /design reads.
 *  Kept in its own module so the doorway components and the page can share
 *  them without the page (a heavy 3D route) being imported into Studio's or
 *  History's bundle. */
export const HANDOFF_KEY = "dar-build-handoff";

/** The scene handed over when a SAVED design is reopened for editing.
 *
 *  Distinct from HANDOFF_KEY, which carries a /redesign RESULT — a photograph
 *  and its analysis, from which Build Mode derives a fresh room. This one
 *  carries a finished scene: the furniture, materials and culture someone
 *  already composed, to be restored exactly as they left it. Conflating the two
 *  would mean re-deriving a room and throwing that work away. */
export const SCENE_HANDOFF_KEY = "dar-build-scene";
