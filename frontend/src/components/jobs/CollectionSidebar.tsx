import { useState } from "react";
import { Folder, FolderOpen, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCollections, useCreateCollection, useDeleteCollection } from "@/hooks/useSavedJobs";
import { cn } from "@/lib/utils";
import type { Collection } from "@/types/api";

interface CollectionSidebarProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function NewCollectionDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const createCollection = useCreateCollection();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createCollection.mutate({ name: name.trim() }, { onSuccess: () => { setOpen(false); setName(""); } });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 shrink-0 justify-start gap-1.5 whitespace-nowrap rounded-md border px-3 text-xs md:h-7 md:w-full md:border-0 md:px-2"
        >
          <Plus className="h-3.5 w-3.5" />
          New collection
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Collection</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="col-name">Name</Label>
            <Input
              id="col-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dream Jobs"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || createCollection.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface CollectionItemProps {
  collection: Collection;
  isSelected: boolean;
  onSelect: () => void;
}

function CollectionItem({ collection, isSelected, onSelect }: CollectionItemProps) {
  const deleteCollection = useDeleteCollection();
  const Icon = isSelected ? FolderOpen : Folder;

  return (
    <div
      className={cn(
        "group flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted md:w-full md:justify-between md:border-0 md:px-2",
        isSelected && "bg-muted font-medium",
      )}
      onClick={onSelect}
    >
      <span className="flex items-center gap-2 truncate">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{collection.name}</span>
        {collection.is_default && (
          <span className="text-xs text-muted-foreground">(default)</span>
        )}
      </span>
      {!collection.is_default && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteCollection.mutate(collection.id);
          }}
          className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive md:inline-flex md:invisible md:group-hover:visible"
          aria-label={`Delete ${collection.name}`}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function CollectionSidebar({ selectedId, onSelect }: CollectionSidebarProps) {
  const { data: collections = [], isLoading } = useCollections();

  return (
    // Desktop: a fixed-width vertical sidebar. Mobile: a full-width horizontal
    // scroll of chips so it never steals width from the job cards.
    <aside className="w-full shrink-0 md:w-52">
      <p className="hidden px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground md:block">
        Collections
      </p>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:gap-1 md:overflow-visible md:px-0 md:pb-0">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            "shrink-0 cursor-pointer whitespace-nowrap rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted md:w-full md:border-0 md:px-2 md:text-left",
            selectedId === null && "bg-muted font-medium",
          )}
        >
          All saved jobs
        </button>

        {isLoading ? (
          <div className="py-2 text-center text-xs text-muted-foreground">Loading…</div>
        ) : (
          collections.map((col) => (
            <CollectionItem
              key={col.id}
              collection={col}
              isSelected={selectedId === col.id}
              onSelect={() => onSelect(col.id)}
            />
          ))
        )}

        <div className="shrink-0 md:pt-1">
          <NewCollectionDialog />
        </div>
      </div>
    </aside>
  );
}
