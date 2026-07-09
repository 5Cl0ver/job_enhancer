"use client";

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
        <Button variant="ghost" size="sm" className="h-7 w-full justify-start gap-1.5 text-xs">
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
        "group flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
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
          className="invisible shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:visible"
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
    <aside className="w-52 shrink-0 space-y-1">
      <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Collections
      </p>

      <div
        className={cn(
          "cursor-pointer rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
          selectedId === null && "bg-muted font-medium",
        )}
        onClick={() => onSelect(null)}
      >
        All saved jobs
      </div>

      {isLoading ? (
        <div className="py-4 text-center text-xs text-muted-foreground">Loading…</div>
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

      <div className="pt-1">
        <NewCollectionDialog />
      </div>
    </aside>
  );
}
