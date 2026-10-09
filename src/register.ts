/**
 * Types an app plugs into gondol, by augmenting this interface (like TanStack Router's `Register`):
 *
 * ```ts
 * declare module "gondol" {
 *   interface Register {
 *     entityType: EntityType; // the union of the app's entity types
 *     messageKey: MessageKey; // the keys of the app's message catalogue (gondol's own included)
 *   }
 * }
 * ```
 *
 * Without it, entity types and message keys are plain strings.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Register {}

/** An entity type of the app (`spacify:<type>:<id>`'s `<type>`). */
export type EntityType = Register extends { entityType: infer T extends string } ? T : string;

/** A key of the app's message catalogue. */
export type MessageKey = Register extends { messageKey: infer K extends string } ? K : string;
