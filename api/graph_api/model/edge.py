class Edge:
    def __init__(self, source: str, target: str, 
                edge_id: str = None,
                weight: float = 1.0,
                directed: bool = True,
                attributes: dict = None):
        self.edge_id = edge_id
        self.source = source
        self.target = target
        self.weight = weight
        self.directed = directed
        self.attributes = attributes or {}

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source": self.source,
            "target": self.target,
            "weight": self.weight,
            "directed": self.directed,
            "attributes": self.attributes,
        }