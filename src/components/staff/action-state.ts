/** Result of a staff server action, safe to import from client components. */
export type ActionState = { status: "idle" | "success" | "info" | "error"; message: string };

export const IDLE: ActionState = { status: "idle", message: "" };

export type StaffAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;
