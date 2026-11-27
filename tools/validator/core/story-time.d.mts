type Document = Record<string, unknown>;
type Issue = (code: string, path: string, message: string) => void;

export const storyTimeFields: readonly ['before', 'overlaps', 'recounts_events'];
export function suppressConditionalWrapper(error: {
  instancePath?: string;
  keyword: string;
  schemaPath: string;
  params: { failingKeyword?: string };
}, resource?: string): boolean;
export function storyPrecedence(events: readonly unknown[]): {
  precedes(from: string, to: string): boolean;
};
export function checkStoryTime(
  doc: Document,
  transitions: ReadonlyMap<string, Document>,
  checkRef: (target: unknown, kind: string, path: string) => string | null,
  issue: Issue,
): void;
export function isUntimed(scenes: Document | undefined): boolean;
export function checkOutlineTiming(
  scenes: Document | undefined,
  intent: Document | undefined,
  variants: Document | undefined,
  issue: (code: string, label: string, path: string, message: string) => void,
): void;
