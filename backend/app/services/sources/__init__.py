"""Job-source registry.

Register a new board by importing its adapter and adding an instance to the
registry below — nothing else in the codebase needs to change.
"""

from app.services.sources.adzuna import AdzunaSource
from app.services.sources.base import JobSource, parse_dt
from app.services.sources.jsearch import JSearchSource
from app.services.sources.remotive import RemotiveSource

#: All available source adapters, keyed by their stable ``name``.
_REGISTRY: dict[str, JobSource] = {
    source.name: source
    for source in (AdzunaSource(), JSearchSource(), RemotiveSource())
}


def get_sources(names: frozenset[str] | None = None) -> list[JobSource]:
    """Return enabled source adapters.

    ``names=None`` returns all; otherwise only the named, known sources (unknown
    names are ignored). Callers pass a subset to respect per-source quotas — e.g.
    scheduled refreshes can stay Adzuna-only to protect the JSearch monthly cap.
    """
    if names is None:
        return list(_REGISTRY.values())
    return [_REGISTRY[n] for n in names if n in _REGISTRY]


def available_source_names() -> frozenset[str]:
    """Names of every registered source."""
    return frozenset(_REGISTRY)


__all__ = ["JobSource", "available_source_names", "get_sources", "parse_dt"]
