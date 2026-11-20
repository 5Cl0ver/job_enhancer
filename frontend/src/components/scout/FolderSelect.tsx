/**
 * "Save into": which collection a Scout search's jobs go to. The first choice
 * is the search's own (pre-filled, so the usual case needs no thought), then
 * the user's collections, then a new one named on the spot.
 */
import { useCollections } from "@/hooks/useSavedJobs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Both null = the pre-filled choice. `newName` not null = a new collection
 * being named (empty until typed). */
export interface Where {
  collectionId: string | null;
  newName: string | null;
}

export const OWN: Where = { collectionId: null, newName: null };

const DEFAULT = "__own__";
const NEW = "__new__";

/** A new collection needs a name before anything can be saved into it. */
export function whereReady(where: Where): boolean {
  return where.newName === null || where.newName.trim() !== "";
}

/** The request fields for a `Where`. */
export function whereBody(where: Where): {
  collection_id?: string;
  new_collection_name?: string;
} {
  if (where.newName !== null) return { new_collection_name: where.newName.trim() };
  return where.collectionId ? { collection_id: where.collectionId } : {};
}

export function FolderSelect({
  value,
  onChange,
  ownLabel,
  ownId,
  label = "Save into",
}: {
  value: Where;
  onChange: (where: Where) => void;
  /** What the pre-filled choice says, e.g. “IT Admin”. */
  ownLabel: string;
  /** The pre-filled collection's id when it already exists, so it isn't
   * listed twice. */
  ownId?: string | null;
  label?: string;
}) {
  const { data: collections = [] } = useCollections();
  const others = collections.filter(
    (c) => c.id !== ownId && c.name.trim().toLowerCase() !== ownLabel.trim().toLowerCase(),
  );
  const current = value.newName !== null ? NEW : (value.collectionId ?? DEFAULT);

  return (
    <div className="flex min-w-0 flex-col gap-2 max-sm:flex-1 sm:flex-row sm:items-center">
      <Select
        value={current}
        onValueChange={(v) =>
          onChange(
            v === NEW
              ? { collectionId: null, newName: "" }
              : { collectionId: v === DEFAULT ? null : v, newName: null },
          )
        }
      >
        <SelectTrigger aria-label={label} className="w-full min-w-0 sm:w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>{ownLabel}</SelectItem>
          {others.length > 0 && <SelectSeparator />}
          {others.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={NEW}>New collection…</SelectItem>
        </SelectContent>
      </Select>
      {value.newName !== null && (
        <Input
          autoFocus
          aria-label="New collection name"
          placeholder="Name it"
          maxLength={100}
          value={value.newName}
          onChange={(e) => onChange({ collectionId: null, newName: e.target.value })}
          className="min-w-0 sm:w-48"
        />
      )}
    </div>
  );
}
