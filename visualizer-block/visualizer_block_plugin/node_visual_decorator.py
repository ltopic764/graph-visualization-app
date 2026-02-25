class NodeVisualDecorator:
    def __init__(self, node, max_visible=4):
        self._node = node
        self.max_visible = max_visible

    @property
    def needs_scroll(self) -> bool:
        # Check if there are too many attributes for simple view
        return len(self._node.attributes) > self.max_visible

    @property
    def display_attributes(self):
        # All attributes, but on HTML is said if there is a need for scroll
        return self._node.attributes

    # From parent
    def __getattr__(self, name):
        return getattr(self._node, name)