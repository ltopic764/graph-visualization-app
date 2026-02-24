class Edge:
    def __init__(self, source: str, target: str, weight: float = 1.0):
        self.source = source
        self.target = target
        self.weight = weight

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "target": self.target,
            "weight": self.weight,
        }