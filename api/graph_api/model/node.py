class Node:
    def __init__(self, node_id: str, label: str = "", attributes: dict = None):
        self.node_id = node_id
        self.label = label or node_id
        self.attributes = attributes or {}

    def to_dict(self) -> dict:
        return {
            "id": self.node_id,
            "label": self.label,
            "attributes": self.attributes,
        }