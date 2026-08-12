/** The sessionStorage key Studio writes and /design reads. Kept in its own
 *  module so the doorway component and the page can share it without the
 *  page (a heavy 3D route) being imported into Studio's bundle. */
export const HANDOFF_KEY = "dar-build-handoff";
