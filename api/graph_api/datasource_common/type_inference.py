# This will be used to automatically recognize attributes types

from datetime import date, datetime
from typing import Any

def infer_type(value: Any) -> Any:
    # Converts raw attribute values to more specific types when possible

    # The goal is to preserve the semantic type of source data so that graph attributes
    # can be filtered and compared correctly

    if value is None:
        return None

    # Keep already typed values unchanged
    if isinstance(value, (bool, int, float, date, datetime)):
        return value

    if isinstance(value, str):
        stripped = value.strip()
        if stripped == "":
            return value

        lowered = stripped.lower()

        # Boolean values
        if lowered == "true":
            return True
        if lowered == "false":
            return False

        # Integer
        try:
            return int(stripped)
        except ValueError:
            pass

        # Float
        try:
            return float(stripped)
        except ValueError:
            pass

        # ISO date
        try:
            return date.fromisoformat(stripped)
        except ValueError:
            pass

        # ISO datetime
        try:
            return datetime.fromisoformat(stripped)
        except ValueError:
            pass

    return value

def infer_attributes(raw_dict: dict) -> dict:
    # Apply type inference to every attribute value in a dictionary
    return {
        key: infer_type(value)
        for key, value in raw_dict.items()
    }
