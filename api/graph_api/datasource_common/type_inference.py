# This will be used to automatically recognize attributes types

from datetime import date
from typing import Union

# What attributes types can an attribute be
AttributeValues = Union[int, float, date, str]

def infer_type(value: str) -> AttributeValues:
    # Convert string value

    # If value is not string return
    if not isinstance(value, str):
        # Make sure the type is right
        if isinstance(value, bool):
            # Boolean is int in python
            return str(value)
        if isinstance(value, (int, float)):
            return value
        return str(value)

    # Now try conversion
    try:
        return int(value)
    except ValueError:
        pass

    try:
        return float(value)
    except ValueError:
        pass

    try:
        return date.fromisoformat(value)
    except ValueError:
        pass

    return value

def infer_attributes(raw_dict: dict) -> dict:
    # Convert the dictionary of string values to converted values

    return {
        key: infer_type(value)
        for key, value in raw_dict.items()
    }
