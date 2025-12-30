"""Package manager adapters."""

from pkgrisk.adapters.base import BaseAdapter
from pkgrisk.adapters.homebrew import HomebrewAdapter

__all__ = ["BaseAdapter", "HomebrewAdapter"]
